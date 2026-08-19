import { randomUUID } from 'node:crypto'
import { normalizeLunaConfig } from './config.mjs'

// This is the transport-neutral Luna JS SDK surface. A host adapter owns the
// capability names behind it; the Harness layer only creates this client and
// never implements an editor operation itself.
export const LUNA_SDK_API = Object.freeze({
  memory: Object.freeze({
    read: 'memory.read',
    search: 'memory.search',
    update: 'memory.update',
    remove: 'memory.remove',
  }),
  media: Object.freeze({
    list: 'media.list',
    read: 'media.read',
    analyze: 'media.analyze',
    getAnalysisTask: 'media.get_analysis_task',
    searchTranscript: 'media.search_transcript',
  }),
  audio: Object.freeze({
    startSpeech: 'audio.start_speech',
    startMusic: 'audio.start_music',
    getTask: 'audio.get_task',
  }),
  project: Object.freeze({
    inspect: 'project.inspect',
    setCanvas: 'project.set_canvas',
  }),
  timeline: Object.freeze({
    inspectContext: 'timeline.inspect_context',
    addMedia: 'timeline.add_media',
    trim: 'timeline.trim',
    split: 'timeline.split',
    move: 'timeline.move',
    remove: 'timeline.remove',
    setProperties: 'timeline.set_properties',
    setTransform: 'timeline.set_transform',
    setAudio: 'timeline.set_audio',
    addText: 'timeline.add_text',
    addHtml: 'timeline.add_html',
    addKeyframe: 'timeline.add_keyframe',
    addTransition: 'timeline.add_transition',
    addMediaBatch: 'timeline.add_media_batch',
    addTextBatch: 'timeline.add_text_batch',
    addTransitionBatch: 'timeline.add_transition_batch',
    listTransitions: 'timeline.list_transitions',
  }),
})

const TIMELINE_CAPABILITY_NAMES = new Set(Object.values(LUNA_SDK_API.timeline))

function responseError(response, payload) {
  if (payload && typeof payload.error === 'string') return payload.error
  if (payload?.error && typeof payload.error.message === 'string') return payload.error.message
  if (payload && typeof payload.message === 'string') return payload.message
  return `Luna SDK capability request failed with HTTP ${response.status}.`
}

function assertCapabilityName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name)) {
    throw new TypeError('Luna SDK capability name is invalid.')
  }
}

function normalizeArguments(args) {
  if (args === undefined) return {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Luna SDK capability arguments must be an object.')
  }
  return args
}

export function createCapabilityTransport(config) {
  const resolved = normalizeLunaConfig(config)
  return Object.freeze({
    async call(name, args = {}) {
      assertCapabilityName(name)
      const requestArgs = normalizeArguments(args)
      const response = await fetch(resolved.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${resolved.token}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          protocol: 'luna.editor',
          apiVersion: 1,
          requestId: randomUUID(),
          ...(resolved.sessionId ? { sessionId: resolved.sessionId } : {}),
          projectId: resolved.projectId,
          name,
          args: requestArgs,
        }),
      })

      const raw = await response.text()
      let payload
      try {
        payload = raw ? JSON.parse(raw) : undefined
      } catch {
        throw new Error(`Luna SDK capability returned invalid JSON (HTTP ${response.status}).`)
      }
      if (!response.ok || !payload?.ok) throw new Error(responseError(response, payload))
      return payload.result
    },
  })
}

export function createLunaSdk(config, { api = LUNA_SDK_API, transport, legacyResults = false } = {}) {
  const resolved = normalizeLunaConfig(config)
  const bridge = transport ?? createCapabilityTransport(resolved)
  const sdk = {}
  for (const [namespace, methods] of Object.entries(api)) {
    sdk[namespace] = {}
    for (const [method, capabilityName] of Object.entries(methods)) {
      sdk[namespace][method] = async (args) => {
        const result = await bridge.call(capabilityName, args)
        return legacyResults ? adaptLegacyResult(capabilityName, result) : result
      }
    }
    Object.freeze(sdk[namespace])
  }
  return Object.freeze(sdk)
}

function isLegacyEnvelope(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    value.ok === true && value.data !== undefined
}

function legacyEnvelope(name, data, value) {
  return {
    ok: true,
    message: `${name} completed.`,
    data,
    ...(value && typeof value === 'object' && !Array.isArray(value)
      ? {
          affectedIds: value.affectedIds ?? [],
          createdIds: value.createdIds ?? [],
          removedIds: value.removedIds ?? [],
          warnings: value.warnings ?? [],
        }
      : {}),
  }
}

function editData(value) {
  const project = value?.project
  const createdItemIds = Array.isArray(value?.createdIds) ? value.createdIds : []
  const items = Array.isArray(project?.timeline?.items)
    ? project.timeline.items.filter((item) => createdItemIds.includes(item.id))
    : []
  return {
    project,
    applied: value?.applied ?? 0,
    operations: value?.results ?? [],
    createdItemIds,
    affectedIds: value?.affectedIds ?? [],
    removedItemIds: value?.removedIds ?? [],
    warnings: value?.warnings ?? [],
    items,
  }
}

function isOperationResult(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.operationId === 'string' && 'data' in value
}

function adaptLegacyResult(name, value) {
  // Harness compatibility is a wire-level adapter. A server that already
  // returns the historical envelope is passed through unchanged, preserving
  // older test hosts and independently upgraded assistants.
  if (isLegacyEnvelope(value)) return value
  const data = isOperationResult(value) ? value.data : value
  const metadata = isOperationResult(value) ? value : value

  if (name === 'media.list') {
    const items = (data?.media ?? []).map((media) => ({
      ...media,
      mediaType: media.mimeType?.split('/')?.[0] ?? 'unknown',
      name: media.fileName,
    }))
    return legacyEnvelope(name, { items, total: data?.total ?? items.length }, metadata)
  }
  if (name === 'media.read') {
    const media = data?.media
    return legacyEnvelope(name, { items: media ? [media] : [] }, metadata)
  }
  if (name === 'project.inspect') {
    const timeline = data?.timeline ?? data?.project?.timeline
    return legacyEnvelope(name, {
      project: data?.project,
      tracks: timeline?.tracks ?? [],
      items: timeline?.items ?? [],
      transitions: timeline?.transitions ?? [],
      keyframes: timeline?.keyframes ?? [],
      counts: data?.counts ?? {},
    }, metadata)
  }
  if (name === 'timeline.inspect_context') {
    return legacyEnvelope(name, {
      tracks: data?.tracks ?? [],
      items: data?.items ?? [],
      transitions: data?.transitions ?? [],
      keyframes: data?.keyframes ?? [],
      projectId: data?.projectId,
      fps: data?.fps,
    }, metadata)
  }
  if (TIMELINE_CAPABILITY_NAMES.has(name) && name !== 'timeline.inspect_context') {
    if (name === 'timeline.list_transitions') {
      return legacyEnvelope(name, { transitions: data?.transitions ?? [] }, metadata)
    }
    if (data?.project || data?.createdIds || data?.results) {
      return legacyEnvelope(name, editData(data), metadata)
    }
  }
  return isOperationResult(value) ? legacyEnvelope(name, data, metadata) : value
}
