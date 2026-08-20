import type { RequestOptions, OperationResult } from "../contracts/common.js"
import { LunaError } from "../contracts/errors.js"
import { LoopbackHttpTransport } from "../transport/loopback-http.js"
import type { LunaTransport, RpcRequest } from "../transport/transport.js"
import { LUNA_EDITOR_API_VERSION, LUNA_EDITOR_PROTOCOL } from "../transport/transport.js"
import type {
  AiClient,
  CapabilitiesClient,
  ClientCall,
  JobsClient,
  LunaClient,
  LunaClientOptions,
  MediaClient,
  PreviewClient,
  ProjectClient,
  RenderClient,
  TimelineClient,
} from "./types.js"

export function createLunaClient(options: LunaClientOptions = {}): LunaClient {
  const transport = createTransport(options)
  const requestIdFactory = options.requestIdFactory ?? defaultRequestId

  const request: ClientCall = async <TParams, TData>(
    method: string,
    params: TParams,
    requestOptions?: RequestOptions,
  ): Promise<OperationResult<TData>> => {
    const rpcRequest: RpcRequest<TParams> = {
      protocol: LUNA_EDITOR_PROTOCOL,
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId: requestIdFactory(),
      name: method,
      args: params,
      context: options.context,
    }
    return transport.request<TData>(rpcRequest, requestOptions)
  }

  return {
    transport,
    request,
    project: createProjectClient(request),
    media: createMediaClient(request),
    timeline: createTimelineClient(request),
    preview: createPreviewClient(request),
    render: createRenderClient(request),
    ai: createAiClient(request),
    jobs: createJobsClient(request),
    capabilities: createCapabilitiesClient(request),
    close: () => transport.close?.(),
  }
}

function createTransport(options: LunaClientOptions): LunaTransport {
  if (options.transport) {
    return options.transport
  }
  if (!options.endpoint) {
    throw new LunaError({ code: "INVALID_REQUEST", message: "Provide a transport or loopback endpoint." })
  }
  return new LoopbackHttpTransport({
    endpoint: options.endpoint,
    token: options.token,
    headers: options.headers,
    defaultTimeoutMs: options.defaultTimeoutMs,
  })
}

function createProjectClient(call: ClientCall): ProjectClient {
  return {
    inspect: (request = {}, options) => call("project.inspect", request, options),
    create: (request, options) => call("project.create", request, options),
    update: (request, options) => call("project.update", request, options),
    save: (request = {}, options) => call("project.save", request, options),
  }
}

function createMediaClient(call: ClientCall): MediaClient {
  return {
    list: (request = {}, options) => call("media.list", request, options),
    read: (request, options) => call("media.read", request, options),
    analyze: (request, options) => call("media.analyze", request, options),
    searchTranscript: (request, options) => call("media.searchTranscript", request, options),
  }
}

function createTimelineClient(call: ClientCall): TimelineClient {
  return {
    inspect: (request = {}, options) => call("timeline.inspect", request, options),
    edit: (request, options) => call("timeline.edit", request, options),
    tracks: {
      add: (request, options) => call("timeline.tracks.add", request, options),
      update: (request, options) => call("timeline.tracks.update", request, options),
      remove: (request, options) => call("timeline.tracks.remove", request, options),
    },
    clips: {
      add: (request, options) => call("timeline.clips.add", request, options),
      update: (request, options) => call("timeline.clips.update", request, options),
      move: (request, options) => call("timeline.clips.move", request, options),
      delete: (request, options) => call("timeline.clips.delete", request, options),
      split: (request, options) => call("timeline.clips.split", request, options),
      trim: (request, options) => call("timeline.clips.trim", request, options),
      setTransform: (request, options) => call("timeline.clips.setTransform", request, options),
      setAudio: (request, options) => call("timeline.clips.setAudio", request, options),
    },
    effects: {
      add: (request, options) => call("timeline.effects.add", request, options),
      update: (request, options) => call("timeline.effects.update", request, options),
      remove: (request, options) => call("timeline.effects.remove", request, options),
    },
    keyframes: {
      add: (request, options) => call("timeline.keyframes.add", request, options),
      update: (request, options) => call("timeline.keyframes.update", request, options),
      remove: (request, options) => call("timeline.keyframes.remove", request, options),
    },
    transitions: {
      add: (request, options) => call("timeline.transitions.add", request, options),
      update: (request, options) => call("timeline.transitions.update", request, options),
      remove: (request, options) => call("timeline.transitions.remove", request, options),
    },
    addText: (request, options) => call("timeline.text.add", request, options),
  }
}

function createPreviewClient(call: ClientCall): PreviewClient {
  return {
    inspect: (request = {}, options) => call("preview.inspect", request, options),
    seek: (request, options) => call("preview.seek", request, options),
    captureFrame: (request = {}, options) => call("preview.captureFrame", request, options),
    layout: (request = {}, options) => call("preview.layout", request, options),
  }
}

function createRenderClient(call: ClientCall): RenderClient {
  return {
    preflight: (request = {}, options) => call("render.preflight", request, options),
    frame: (request, options) => call("render.frame", request, options),
    export: (request = {}, options) => call("render.export", request, options),
  }
}

function createAiClient(call: ClientCall): AiClient {
  return {
    listProviders: (options) => call("ai.providers.list", {}, options),
    transcribe: (request, options) => call("ai.transcribe", request, options),
    analyze: (request, options) => call("ai.analyze", request, options),
    detectSilence: (request, options) => call("ai.silence.detect", request, options),
    detectFillers: (request, options) => call("ai.fillers.detect", request, options),
    generateSpeech: (request, options) => call("ai.speech.generate", request, options),
    generateMusic: (request, options) => call("ai.music.generate", request, options),
  }
}

function createJobsClient(call: ClientCall): JobsClient {
  return {
    get: (request, options) => call("jobs.get", request, options),
    list: (request = {}, options) => call("jobs.list", request, options),
    wait: (request, options) => call("jobs.wait", request, options),
    cancel: (request, options) => call("jobs.cancel", request, options),
    retry: (request, options) => call("jobs.retry", request, options),
  }
}

function createCapabilitiesClient(call: ClientCall): CapabilitiesClient {
  return {
    list: (request = {}, options) => call("capabilities.list", request, options),
    describe: (request, options) => call("capabilities.describe", request, options),
  }
}

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }
  return `luna-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
