import { app } from 'electron'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import type {
  AiSelectionItem,
  AiSelectionProgress,
  AiSelectionSession,
  AiSelectionStartRequest,
  AiSelectionUserOperation,
  WorkspaceProject,
} from '../src/shared/types'
import { applySelectionPlan, buildShootingEvents, buildSimilarityGroups } from './aiSelectionAlgorithms'
import { analyzeIndexedMedia, failedItem, indexMediaSource, pendingItem } from './aiSelectionMedia'
import { normalizeAiSelectionItem } from './aiSelectionMigration'
import { analyzePersonEvidence } from './aiSelectionPerson'
import { applyAiSelectionUserOperation, createAiSelectionSnapshot, type AiSelectionSnapshot } from './aiSelectionOperations'
import { analyzeVideoStory } from './aiSelectionVideo'
import { getSettings } from './settingsService'
import { shutdownSpecializedSegmentationWorker } from './specializedSegmentationService'
import { createWorkspaceProject } from './workspaceProjectService'

const ANALYSIS_VERSION = 'selection-redesign-4'
const ROOT_DIR = 'ai-selection'

interface StoredSession extends AiSelectionSession {
  undoStack: AiSelectionSnapshot[]
  redoStack: AiSelectionSnapshot[]
}

type Notify = (event: 'progress' | 'session', payload: AiSelectionProgress | AiSelectionSession) => void

const sessions = new Map<string, StoredSession>()
let loaded = false
let activeSessionId: string | null = null
let activeController: AbortController | null = null
let notify: Notify = () => undefined

export function setAiSelectionNotifier(next: Notify): void {
  notify = next
}

function rootDir(): string {
  return path.join(app.getPath('userData'), '.luna-cache', ROOT_DIR)
}

function sessionPath(id: string): string {
  if (!/^selection_[a-z0-9_-]+$/i.test(id)) throw new Error('选片任务标识无效')
  return path.join(rootDir(), 'sessions', `${id}.json`)
}

function itemCachePath(id: string, mode: AiSelectionSession['mode']): string {
  if (!/^media_[a-f0-9]+$/.test(id)) throw new Error('素材缓存标识无效')
  return path.join(rootDir(), 'items', id, `${ANALYSIS_VERSION}-${mode}.json`)
}

async function readCachedItem(id: string, mode: AiSelectionSession['mode']): Promise<AiSelectionItem | null> {
  try {
    const item = JSON.parse(await fs.readFile(itemCachePath(id, mode), 'utf8')) as AiSelectionItem
    normalizeAiSelectionItem(item)
    return item
  } catch {
    return null
  }
}

async function writeCachedItem(item: AiSelectionItem, mode: AiSelectionSession['mode']): Promise<void> {
  if (item.error) return
  const destination = itemCachePath(item.id, mode)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(item)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rm(destination, { force: true })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

function publicSession(session: StoredSession): AiSelectionSession {
  const { undoStack, redoStack, ...value } = session
  return structuredClone({ ...value, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 })
}

function refreshCounts(session: StoredSession): void {
  session.counts = {
    total: session.counts.total,
    completed: session.items.filter((item) => item.analysisState !== 'pending').length,
    failed: session.items.filter((item) => Boolean(item.error)).length,
    selected: session.items.filter((item) => item.selected).length,
  }
}

function touch(session: StoredSession): void {
  session.revision += 1
  session.updatedAt = new Date().toISOString()
  refreshCounts(session)
}

async function persist(session: StoredSession): Promise<void> {
  const destination = sessionPath(session.id)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  const directory = path.join(rootDir(), 'sessions')
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8')) as StoredSession
      if (parsed.schemaVersion !== 1 || !parsed.id) continue
      parsed.undoStack ??= []
      parsed.redoStack ??= []
      parsed.purpose ??= 'general'
      parsed.workflow ??= 'assist'
      parsed.undoStack.forEach((snapshot) => { snapshot.mode ??= parsed.mode; snapshot.purpose ??= parsed.purpose; snapshot.workflow ??= parsed.workflow })
      parsed.redoStack.forEach((snapshot) => { snapshot.mode ??= parsed.mode; snapshot.purpose ??= parsed.purpose; snapshot.workflow ??= parsed.workflow })
      parsed.items.forEach((item) => {
        normalizeAiSelectionItem(item)
      })
      parsed.similarityGroups.forEach((group) => {
        group.reason ??= group.kind === 'exact' ? '完全相同的文件' : '画面相似'
        group.confidence ??= group.kind === 'exact' ? 1 : 0.7
      })
      if (parsed.status === 'indexing' || parsed.status === 'analyzing') parsed.status = 'interrupted'
      if (parsed.analysisVersion !== ANALYSIS_VERSION && parsed.items.some((item) => item.analysisState === 'ready')) {
        parsed.analysisVersion = ANALYSIS_VERSION
        rebuildSelectionResult(parsed)
        refreshCounts(parsed)
        await persist(parsed)
      }
      refreshCounts(parsed)
      sessions.set(parsed.id, parsed)
    } catch {
      // Ignore a damaged session; other sessions remain available.
    }
  }
}

function emitSession(session: StoredSession): void {
  notify('session', publicSession(session))
}

function emitProgress(session: StoredSession, currentLabel: string | null): void {
  notify('progress', {
    sessionId: session.id,
    revision: session.revision,
    status: session.status,
    phase: session.phase,
    counts: session.counts,
    currentLabel,
  })
}

async function updateAndPersist(session: StoredSession, currentLabel: string | null = null): Promise<void> {
  touch(session)
  await persist(session)
  emitProgress(session, currentLabel)
  emitSession(session)
}

function abortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|已取消/i.test(error.message))
}

function rebuildSelectionResult(session: StoredSession): void {
  const generatedEvents = buildShootingEvents(session.items)
  const existingModifiedEvents = session.events.filter((event) => event.userModified)
  session.events = existingModifiedEvents.length > 0 ? existingModifiedEvents : generatedEvents
  const eventByItem = new Map(session.events.flatMap((event) => event.itemIds.map((id) => [id, event.id] as const)))
  session.items.forEach((item) => { item.eventId = eventByItem.get(item.id) ?? null })
  const generatedGroups = buildSimilarityGroups(session.items, session.events)
  const modifiedGroups = session.similarityGroups.filter((group) => group.userModified)
  const modifiedItemIds = new Set(modifiedGroups.flatMap((group) => group.itemIds))
  session.similarityGroups = [
    ...modifiedGroups,
    ...generatedGroups.filter((group) => !group.itemIds.some((id) => modifiedItemIds.has(id))),
  ]
  applySelectionPlan(session.items, session.similarityGroups, session.mode, session.purpose, session.workflow)
}

async function runSession(session: StoredSession): Promise<void> {
  const controller = new AbortController()
  activeSessionId = session.id
  activeController = controller
  try {
    session.status = 'indexing'
    session.phase = 'indexing'
    session.error = null
    await updateAndPersist(session)
    const indexed = await indexMediaSource(session.source, controller.signal)
    session.counts.total = indexed.length
    const previousItems = new Map(session.items.map((item) => [item.id, item]))
    session.items = indexed.map((media) => previousItems.get(media.id) ?? pendingItem(media))
    await updateAndPersist(session)
    const completed = new Set(session.items.filter((item) => item.analysisState !== 'pending').map((item) => item.id))
    const sizeCounts = new Map<number, number>()
    indexed.forEach((item) => sizeCounts.set(item.bytes, (sizeCounts.get(item.bytes) ?? 0) + 1))
    session.status = 'analyzing'
    session.phase = 'metadata'
    await updateAndPersist(session)

    const ordered = [...indexed].sort((a, b) => Number(a.kind === 'video') - Number(b.kind === 'video') || a.path.localeCompare(b.path))
    const photos = ordered.filter((item) => item.kind === 'image')
    const videos = ordered.filter((item) => item.kind === 'video')
    session.phase = 'photos'
    const pendingPhotos = photos.filter((item) => !completed.has(item.id))
    for (let offset = 0; offset < pendingPhotos.length; offset += 3) {
      controller.signal.throwIfAborted()
      const batch = pendingPhotos.slice(offset, offset + 3)
      const analyzed = await Promise.all(batch.map(async (media): Promise<AiSelectionItem> => {
        try {
          const needsExactHash = (sizeCounts.get(media.bytes) ?? 0) > 1
          const cached = await readCachedItem(media.id, session.mode)
          const reusable = cached && (!needsExactHash || Boolean(cached.exactHash)) ? cached : null
          const item = reusable ?? await analyzeIndexedMedia(media, session.mode, needsExactHash, controller.signal)
          if (!reusable) await writeCachedItem(item, session.mode)
          return item
        } catch (error) {
          if (abortLike(error)) throw error
          return failedItem(media, error)
        }
      }))
      for (const item of analyzed) session.items.splice(session.items.findIndex((candidate) => candidate.id === item.id), 1, item)
      await updateAndPersist(session, batch[batch.length - 1]?.name ?? null)
    }

    controller.signal.throwIfAborted()
    session.phase = 'grouping'
    rebuildSelectionResult(session)
    session.phase = 'ranking'
    await updateAndPersist(session)

    session.phase = 'videos'
    await updateAndPersist(session)
    const pendingVideos = videos.filter((item) => !completed.has(item.id))
    const videoConcurrency = os.totalmem() >= 16 * 1024 ** 3 ? 2 : 1
    for (let offset = 0; offset < pendingVideos.length; offset += videoConcurrency) {
      controller.signal.throwIfAborted()
      const batch = pendingVideos.slice(offset, offset + videoConcurrency)
      const analyzed = await Promise.all(batch.map(async (media): Promise<AiSelectionItem> => {
        try {
          // Large videos never receive a full-file hash during the first pass.
          const cached = await readCachedItem(media.id, session.mode)
          const item = cached ?? await analyzeIndexedMedia(media, session.mode, false, controller.signal)
          if (!cached) await writeCachedItem(item, session.mode)
          return item
        } catch (error) {
          if (abortLike(error)) throw error
          return failedItem(media, error)
        }
      }))
      for (const item of analyzed) session.items.splice(session.items.findIndex((candidate) => candidate.id === item.id), 1, item)
      await updateAndPersist(session, batch[batch.length - 1]?.name ?? null)
    }

    rebuildSelectionResult(session)
    session.phase = 'ranking'
    await updateAndPersist(session)
    session.phase = 'done'
    session.status = 'completed'
    await updateAndPersist(session)
  } catch (error) {
    if (!abortLike(error)) {
      session.status = 'failed'
      session.error = error instanceof Error ? error.message : String(error)
      await updateAndPersist(session)
    }
  } finally {
    if (activeSessionId === session.id) {
      activeSessionId = null
      activeController = null
    }
    queueMicrotask(() => { void scheduleNext() })
  }
}

async function scheduleNext(): Promise<void> {
  await ensureLoaded()
  if (activeSessionId) return
  const next = [...sessions.values()]
    .filter((session) => session.status === 'queued')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
  if (next) void runSession(next)
}

function requireSession(id: string): StoredSession {
  const session = sessions.get(id)
  if (!session) throw new Error('选片任务不存在')
  return session
}

export async function startAiSelection(request: AiSelectionStartRequest): Promise<AiSelectionSession> {
  await ensureLoaded()
  const now = new Date().toISOString()
  const id = `selection_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const session: StoredSession = {
    schemaVersion: 1,
    analysisVersion: ANALYSIS_VERSION,
    id,
    name: request.name?.trim() || request.source.label || 'AI 选片',
    source: structuredClone(request.source),
    mode: request.mode,
    purpose: request.purpose ?? 'general',
    workflow: request.workflow ?? 'assist',
    status: 'queued',
    phase: 'indexing',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    counts: { total: 0, completed: 0, failed: 0, selected: 0 },
    items: [],
    events: [],
    similarityGroups: [],
    error: null,
    canUndo: false,
    canRedo: false,
    undoStack: [],
    redoStack: [],
  }
  sessions.set(id, session)
  await persist(session)
  emitSession(session)
  void scheduleNext()
  return publicSession(session)
}

export async function listAiSelectionSessions(): Promise<AiSelectionSession[]> {
  await ensureLoaded()
  return [...sessions.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(publicSession)
}

export async function getAiSelectionSession(id: string): Promise<AiSelectionSession | null> {
  await ensureLoaded()
  const session = sessions.get(id)
  return session ? publicSession(session) : null
}

export async function pauseAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (session.status === 'queued' || activeSessionId === id) {
    session.status = 'paused'
    if (activeSessionId === id) activeController?.abort()
    await updateAndPersist(session)
  }
  return publicSession(session)
}

export async function resumeAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (['paused', 'interrupted', 'failed', 'canceled'].includes(session.status)) {
    session.status = 'queued'
    session.error = null
    await updateAndPersist(session)
    void scheduleNext()
  }
  return publicSession(session)
}

export async function cancelAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (session.status !== 'completed') {
    session.status = 'canceled'
    if (activeSessionId === id) activeController?.abort()
    await updateAndPersist(session)
  }
  return publicSession(session)
}

function restoreSnapshot(session: StoredSession, snapshot: AiSelectionSnapshot): void {
  session.mode = snapshot.mode
  session.purpose = snapshot.purpose
  session.workflow = snapshot.workflow
  session.items = structuredClone(snapshot.items)
  session.events = structuredClone(snapshot.events)
  session.similarityGroups = structuredClone(snapshot.similarityGroups)
}

export async function applyAiSelectionOperation(id: string, revision: number, operation: AiSelectionUserOperation): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (revision > session.revision) throw new Error('选片结果版本无效')
  session.undoStack.push(createAiSelectionSnapshot(session))
  session.undoStack = session.undoStack.slice(-20)
  session.redoStack = []
  applyAiSelectionUserOperation(session, operation)
  await updateAndPersist(session)
  return publicSession(session)
}

export async function undoAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  const snapshot = session.undoStack.pop()
  if (snapshot) { session.redoStack.push(createAiSelectionSnapshot(session)); restoreSnapshot(session, snapshot); await updateAndPersist(session) }
  return publicSession(session)
}

export async function redoAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  const snapshot = session.redoStack.pop()
  if (snapshot) { session.undoStack.push(createAiSelectionSnapshot(session)); restoreSnapshot(session, snapshot); await updateAndPersist(session) }
  return publicSession(session)
}

export async function analyzeAiSelectionPeople(id: string, itemIds: string[]): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  const targets = [...new Set(itemIds)].map((itemId) => session.items.find((item) => item.id === itemId))
    .filter((item): item is AiSelectionItem => Boolean(item && item.analysisState === 'ready'))
  if (targets.length === 0) throw new Error('没有可进行人物分析的素材')
  const controller = new AbortController()
  try {
    for (const item of targets) {
      item.personEvidence = await analyzePersonEvidence(item, controller.signal)
      const evidenceTags = item.personEvidence.detected ? ['人物', '人像', '主体'] : ['无人像']
      if (item.personEvidence.faceCount > 0) evidenceTags.push('人脸')
      if (item.personEvidence.eyeState === 'closed') evidenceTags.push('闭眼', '建议复查')
      if (item.personEvidence.eyeState === 'mixed') evidenceTags.push('眨眼', '建议复查')
      if (item.personEvidence.faceVisibility === 'occluded') evidenceTags.push('面部遮挡', '建议复查')
      item.semanticTags = [...new Set([...item.semanticTags, ...evidenceTags])]
      await updateAndPersist(session, item.name)
    }
  } finally {
    shutdownSpecializedSegmentationWorker()
  }
  rebuildSelectionResult(session)
  await updateAndPersist(session)
  return publicSession(session)
}

export async function analyzeAiSelectionVideos(id: string, itemIds: string[]): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  const targets = [...new Set(itemIds)].map((itemId) => session.items.find((item) => item.id === itemId))
    .filter((item): item is AiSelectionItem => Boolean(item && item.kind === 'video' && item.analysisState === 'ready' && item.duration && item.duration > 0.2))
  if (targets.length === 0) throw new Error('没有可以整理的视频')
  const controller = new AbortController()
  for (const item of targets) {
    if (item.videoKeyframes.length > 0) continue
    const story = await analyzeVideoStory(item, item.duration ?? 1, path.join(rootDir(), 'video-stories'), controller.signal)
    item.videoKeyframes = story.keyframes
    item.videoSegments = story.segments
    const usable = story.segments.filter((segment) => segment.status === 'usable').length
    item.semanticTags = [...new Set([...item.semanticTags, '视频故事板', usable > 0 ? '可用片段' : '建议复查', ...story.keyframes.flatMap((frame) => frame.semanticTags)])]
    item.recommendationReason = usable > 0 ? '已整理出可以快速查看的视频片段' : '这些视频片段建议再看一眼'
    await writeCachedItem(item, session.mode)
    await updateAndPersist(session, item.name)
  }
  return publicSession(session)
}

export async function createProjectFromAiSelection(id: string, name: string): Promise<WorkspaceProject> {
  await ensureLoaded()
  const session = requireSession(id)
  const assets = session.items.filter((item) => item.selected && !item.error).map((item) => {
    const segment = item.videoSegments.find((candidate) => candidate.selected)
    return {
      id: item.id,
      name: item.name,
      path: item.path,
      kind: item.kind,
      thumbnailUrl: item.thumbnailUrl,
      ...(segment ? { pipeline: { trim: { startTime: segment.startTime, endTime: segment.endTime } } } : {}),
    }
  })
  if (assets.length === 0) throw new Error('请先选择至少一个可用素材')
  const settings = await getSettings()
  return createWorkspaceProject(settings.downloadDir, name.trim() || session.name, assets)
}

export async function removeAiSelectionSession(id: string): Promise<void> {
  await ensureLoaded()
  if (activeSessionId === id) throw new Error('请先暂停或取消当前任务')
  sessions.delete(id)
  await fs.rm(sessionPath(id), { force: true })
}
