import type { CompositionLayer } from '../../shared/types'
import { WebGpuCompositionRenderer } from './composition'
import type {
  WebGpuVideoExportProgressMessage,
  WebGpuVideoExportSourceMessage,
  WebGpuVideoExportStartMessage,
  WebGpuVideoExportWorkerMessage,
  WebGpuVideoExportWorkerResponse,
} from './video-export-protocol'

type MediabunnyModule = typeof import('mediabunny')
type MediabunnyInput = InstanceType<MediabunnyModule['Input']>
type MediabunnyVideoTrack = NonNullable<Awaited<ReturnType<MediabunnyInput['getPrimaryVideoTrack']>>>
type MediabunnyVideoSink = InstanceType<MediabunnyModule['VideoSampleSink']>

interface WorkerScope {
  onmessage: ((event: MessageEvent<WebGpuVideoExportWorkerMessage>) => void) | null
  postMessage(message: WebGpuVideoExportWorkerResponse, transfer?: Transferable[]): void
}

interface PendingChunkAck {
  resolve: () => void
  reject: (error: Error) => void
  cleanup: () => void
}

interface VideoSourceState {
  source: WebGpuVideoExportSourceMessage
  input: MediabunnyInput
  track: MediabunnyVideoTrack
  sink: MediabunnyVideoSink
  firstTimestamp: number
  duration: number
}

/**
 * Keep one encoded frame in flight while the next frame is decoded and rendered.
 * Awaiting every add() inline serializes GPU composition and HEVC encoding.
 */
class VideoEncodeQueue {
  private pending: Promise<void> | null = null

  constructor(private readonly source: InstanceType<MediabunnyModule['VideoSampleSource']>) {}

  async add(sample: InstanceType<MediabunnyModule['VideoSample']>): Promise<void> {
    const previous = this.pending
    this.pending = this.source.add(sample).finally(() => sample.close())
    if (previous) await previous
  }

  async drain(): Promise<void> {
    await this.pending
    this.pending = null
  }
}

type EncodableVideoCodec = 'avc' | 'hevc'

const workerScope = globalThis as unknown as WorkerScope
let activeController: AbortController | null = null
let nextChunkId = 1
const pendingChunkAcks = new Map<number, PendingChunkAck>()

function post(message: WebGpuVideoExportWorkerResponse, transfer?: Transferable[]): void {
  workerScope.postMessage(message, transfer)
}

function abortError(): DOMException {
  return new DOMException('视频导出已取消', 'AbortError')
}

function checkCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function rejectPendingChunkAcks(error: Error): void {
  for (const [id, pending] of pendingChunkAcks) {
    pendingChunkAcks.delete(id)
    pending.cleanup()
    pending.reject(error)
  }
}

function acknowledgeChunk(id: number, errorMessage?: string): void {
  const pending = pendingChunkAcks.get(id)
  if (!pending) return
  pendingChunkAcks.delete(id)
  pending.cleanup()
  if (errorMessage) {
    pending.reject(new Error(errorMessage))
  } else {
    pending.resolve()
  }
}

function postOutputChunk(data: Uint8Array, signal: AbortSignal): Promise<void> {
  checkCanceled(signal)
  const id = nextChunkId
  nextChunkId += 1
  const bytes = data.slice()
  const buffer = bytes.buffer
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      if (!pendingChunkAcks.delete(id)) return
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    pendingChunkAcks.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', onAbort) })
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      post({ type: 'chunk', id, data: buffer }, [buffer])
    } catch (error) {
      pendingChunkAcks.delete(id)
      signal.removeEventListener('abort', onAbort)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function postProgress(
  phase: WebGpuVideoExportProgressMessage['phase'],
  progress: number,
  currentFrame: number,
  totalFrames: number,
  message: string,
): void {
  post({
    type: 'progress',
    phase,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    currentFrame,
    totalFrames,
    message,
  })
}

function bitrateForPreset(
  qualityPreset: string,
  width: number,
  height: number,
  fps: number,
  sourceBitrate: number,
): number {
  const originalBitrate = qualityPreset === 'original' || qualityPreset === 'source'
    ? sourceBitrate
    : 0
  const customBitrate = /^custom:(\d+(?:\.\d+)?)k$/.exec(qualityPreset)
  const requestedBitrate = customBitrate
    ? Number(customBitrate[1]) * 1000
    : originalBitrate
  if (Number.isFinite(requestedBitrate) && requestedBitrate > 0) {
    return Math.max(4_000_000, Math.min(80_000_000, Math.round(requestedBitrate)))
  }

  const multiplier = qualityPreset === 'small'
    ? 0.06
    : qualityPreset === 'standard'
      ? 0.09
      : qualityPreset === 'original-like'
        ? 0.16
        : 0.12
  return Math.max(4_000_000, Math.min(80_000_000, Math.round(width * height * fps * multiplier)))
}

function sourceKeyForLayer(layer: CompositionLayer): string {
  return layer.source.key ?? layer.source.path
}

function sourceTimeForLayer(layer: CompositionLayer, compositionTime: number): number {
  const timing = layer.source.time
  const start = timing?.start ?? 0
  const offset = timing?.offset ?? 0
  const elapsed = Math.max(0, compositionTime - offset)
  const boundedElapsed = timing?.duration != null && Number.isFinite(timing.duration)
    ? Math.min(elapsed, Math.max(0, timing.duration - 0.001))
    : elapsed
  return start + boundedElapsed
}

async function copyAudioPackets(params: {
  mediabunny: MediabunnyModule
  audioTrack: Awaited<ReturnType<MediabunnyInput['getPrimaryAudioTrack']>>
  audioSource: InstanceType<MediabunnyModule['EncodedAudioPacketSource']>
  sourceStart: number
  outputOffset: number
  duration: number
  signal: AbortSignal
}): Promise<void> {
  if (!params.audioTrack) return
  const sink = new params.mediabunny.EncodedPacketSink(params.audioTrack)
  const decoderConfig = await params.audioTrack.getDecoderConfig()
  const firstTimestamp = await params.audioTrack.getFirstTimestamp()
  for await (const packet of sink.packets()) {
    checkCanceled(params.signal)
    const sourceTimestamp = packet.timestamp - firstTimestamp
    const outputTimestamp = sourceTimestamp - params.sourceStart + params.outputOffset
    const outputEnd = outputTimestamp + packet.duration
    if (outputEnd <= 0 || outputTimestamp >= params.duration) continue
    await params.audioSource.add(
      packet.clone({ timestamp: Math.max(0, outputTimestamp) }),
      decoderConfig ? { decoderConfig } : undefined,
    )
  }
  params.audioSource.close()
}

async function createVideoSourceStates(
  mediabunny: MediabunnyModule,
  message: WebGpuVideoExportStartMessage,
  signal: AbortSignal,
): Promise<Map<string, VideoSourceState>> {
  const states = new Map<string, VideoSourceState>()
  for (const source of message.sources.filter((candidate) => candidate.sourceType === 'video')) {
    checkCanceled(signal)
    const input = new mediabunny.Input({
      formats: mediabunny.ALL_FORMATS,
      source: new mediabunny.BlobSource(new Blob([source.bytes], { type: source.mimeType })),
    })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track) throw new Error(`视频源没有视频轨道: ${source.fileName}`)
      states.set(source.key, {
        source,
        input,
        track,
        sink: new mediabunny.VideoSampleSink(track, {
          hardwareAcceleration: 'prefer-hardware',
          optimizeForLatency: true,
        }),
        firstTimestamp: await track.getFirstTimestamp(),
        duration: await track.computeDuration(),
      })
    } catch (error) {
      input.dispose()
      throw error
    }
  }
  return states
}

function closeFrames(frames: Map<string, VideoFrame>): void {
  for (const frame of frames.values()) frame.close()
  frames.clear()
}

async function runExport(message: WebGpuVideoExportStartMessage, signal: AbortSignal): Promise<void> {
  const mediabunny: MediabunnyModule = await import('mediabunny')
  const {
    AppendOnlyStreamTarget,
    EncodedAudioPacketSource,
    Mp4OutputFormat,
    Output,
    VideoSample,
    VideoSampleSource,
    canEncodeVideo,
  } = mediabunny

  postProgress('preparing', 2, 0, 0, '准备视频导出')
  checkCanceled(signal)

  const videoStates = await createVideoSourceStates(mediabunny, message, signal)
  const videoLayersByKey = new Map<string, CompositionLayer[]>()
  for (const layer of message.composition.layers) {
    if (layer.source.sourceType !== 'video') continue
    const key = sourceKeyForLayer(layer)
    const layers = videoLayersByKey.get(key) ?? []
    layers.push(layer)
    videoLayersByKey.set(key, layers)
  }
  const primaryLayer = message.composition.layers.find((layer) => layer.source.sourceType === 'video')
  const primaryKey = primaryLayer ? sourceKeyForLayer(primaryLayer) : null
  const primaryState = primaryKey ? videoStates.get(primaryKey) : undefined
  if (primaryLayer && !primaryState) throw new Error(`视频源尚未传入: ${primaryKey}`)

  const imageSources = new Map(
    message.sources
      .filter((source) => source.sourceType === 'image')
      .map((source) => [source.path, source]),
  )
  const imageBitmaps = new Map<string, ImageBitmap>()
  const inputDuration = primaryState?.duration ?? 0
  const duration = message.composition.canvas.duration != null
    && Number.isFinite(message.composition.canvas.duration)
    && message.composition.canvas.duration > 0
    ? message.composition.canvas.duration
    : inputDuration
  if (!(duration > 0)) throw new Error('WebGPU 视频导出缺少有效时长')
  const packetStats = primaryState ? await primaryState.track.computePacketStats(60) : null
  const fps = Math.max(1, Math.min(120, message.fps ?? (packetStats?.averagePacketRate || 30)))
  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  const sourceBitrate = packetStats?.averageBitrate ?? 0
  const sourceCodec = primaryState ? await primaryState.track.getCodec() : null
  let outputCodec: EncodableVideoCodec = sourceCodec === 'hevc' ? 'hevc' : 'avc'
  const bitrate = bitrateForPreset(message.qualityPreset, message.width, message.height, fps, sourceBitrate)
  const encoderOptions = {
    width: message.width,
    height: message.height,
    bitrate,
    hardwareAcceleration: 'prefer-hardware' as const,
  }
  if (!(await canEncodeVideo(outputCodec, encoderOptions))) {
    if (outputCodec !== 'hevc' || !(await canEncodeVideo('avc', encoderOptions))) {
      throw new Error('当前 Electron 没有可用的视频编码器')
    }
    outputCodec = 'avc'
  }

  let output: InstanceType<typeof Output> | null = null
  let videoEncodeQueue: VideoEncodeQueue | null = null
  let renderer: WebGpuCompositionRenderer | null = null
  let completed = false
  let runtimeError: Error | null = null
  const currentFrames = new Map<string, VideoFrame>()
  const primaryTiming = primaryLayer?.source.time
  const lutTexts = new Map(message.luts.map((lut) => [lut.path, lut.text]))
  const maskSources = new Map(message.masks.map((mask) => [
    `${mask.projectId}\u0000${mask.path}`,
    mask,
  ]))

  try {
    const format = new Mp4OutputFormat({ fastStart: 'fragmented' })
    const target = new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({
      write: (chunk) => postOutputChunk(chunk, signal),
    }))
    output = new Output({ format, target })
    const videoSource = new VideoSampleSource({
      codec: outputCodec,
      bitrate,
      bitrateMode: 'variable',
      keyFrameInterval: 2,
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-hardware',
    })
    videoEncodeQueue = new VideoEncodeQueue(videoSource)
    output.addVideoTrack(videoSource, { frameRate: fps })

    const audioTrack = message.includeAudio && primaryState
      ? await primaryState.input.getPrimaryAudioTrack()
      : null
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null
    const audioCopied = Boolean(audioTrack && audioCodec && format.getSupportedAudioCodecs().includes(audioCodec))
    const audioSource = audioCopied ? new EncodedAudioPacketSource(audioCodec!) : null
    if (audioSource) output.addAudioTrack(audioSource)

    postProgress('preparing', 8, 0, totalFrames, `${message.width} x ${message.height}，${fps.toFixed(2)} FPS，${videoStates.size} 个视频源`)
    checkCanceled(signal)
    await output.start()

    const audioTask = audioSource && audioTrack
      ? copyAudioPackets({
          mediabunny,
          audioTrack,
          audioSource,
          sourceStart: primaryTiming?.start ?? 0,
          outputOffset: primaryTiming?.offset ?? 0,
          duration,
          signal,
        })
      : null
    renderer = new WebGpuCompositionRenderer(new OffscreenCanvas(message.width, message.height))
    await renderer.initialize({
      resolveImage: async (path) => {
        const cached = imageBitmaps.get(path)
        if (cached) return cached
        const source = imageSources.get(path)
        if (!source) throw new Error(`静态图层源尚未传入: ${path}`)
        const bitmap = await createImageBitmap(new Blob([source.bytes], { type: source.mimeType }))
        imageBitmaps.set(path, bitmap)
        return bitmap
      },
      resolveSource: async (layer) => {
        const frame = currentFrames.get(sourceKeyForLayer(layer))
        if (!frame) throw new Error(`视频帧尚未准备好: ${layer.source.path}`)
        return frame
      },
      resolveLut: async (path) => {
        const text = lutTexts.get(path)
        if (text == null) throw new Error(`LUT 源尚未传入: ${path}`)
        return text
      },
      resolveMask: async (layer, path) => {
        const source = maskSources.get(`${layer.maskProjectId ?? ''}\u0000${path}`)
        if (!source) throw new Error(`蒙版源尚未传入: ${path}`)
        return {
          width: source.width,
          height: source.height,
          bytes: new Uint8Array(source.bytes),
        }
      },
      onDeviceLost: (error) => { runtimeError = new Error(error) },
      onError: (error) => { runtimeError = new Error(error) },
    })

    postProgress('decoding', 10, 0, totalFrames, '开始按合成时间读取视频')
    let frameCount = 0
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      checkCanceled(signal)
      if (runtimeError) throw runtimeError
      const compositionTime = frameIndex / fps
      const samples: Array<Awaited<ReturnType<MediabunnyVideoSink['getSample']>>> = []
      closeFrames(currentFrames)

      for (const [key, layers] of videoLayersByKey) {
        const state = videoStates.get(key)
        if (!state) throw new Error(`视频源尚未准备好: ${key}`)
        const layer = layers[0]
        if (!layer) continue
        const sourceTimestamp = state.firstTimestamp + sourceTimeForLayer(layer, compositionTime)
        const sample = await state.sink.getSample(sourceTimestamp)
        if (!sample) continue
        samples.push(sample)
        currentFrames.set(key, sample.toVideoFrame())
      }

      const primaryFrame = primaryKey ? currentFrames.get(primaryKey) : undefined
      if (primaryState && !primaryFrame) {
        closeFrames(currentFrames)
        for (const sample of samples) sample?.close()
        continue
      }

      try {
        await renderer.render(message.composition, compositionTime)
        await renderer.waitForGpu()
        if (runtimeError) throw runtimeError
        const outputSample = new VideoSample(renderer.canvas, {
          timestamp: compositionTime,
          duration: 1 / fps,
        })
        postProgress('rendering', 10 + (frameCount / totalFrames) * 82, frameCount, totalFrames, `渲染并编码第 ${frameCount + 1} 帧`)
        await videoEncodeQueue.add(outputSample)
      } finally {
        closeFrames(currentFrames)
        for (const sample of samples) sample?.close()
      }
      frameCount += 1
    }

    checkCanceled(signal)
    postProgress('finalizing', 94, frameCount, totalFrames, '等待编码和音频完成')
    await videoEncodeQueue.drain()
    if (audioTask) await audioTask
    checkCanceled(signal)
    await output.finalize()
    completed = true
    post({
      type: 'done',
      duration,
      frameCount,
      audioCopied,
    })
  } finally {
    rejectPendingChunkAcks(abortError())
    closeFrames(currentFrames)
    renderer?.destroy()
    for (const bitmap of imageBitmaps.values()) bitmap.close()
    for (const state of videoStates.values()) state.input.dispose()
    await videoEncodeQueue?.drain().catch(() => undefined)
    if (output && !completed) await output.cancel().catch(() => undefined)
  }
}

workerScope.onmessage = (event) => {
  if (event.data.type === 'chunk-ack') {
    acknowledgeChunk(event.data.id, event.data.error)
    return
  }
  if (event.data.type === 'cancel') {
    activeController?.abort()
    rejectPendingChunkAcks(abortError())
    return
  }
  if (activeController) return
  const controller = new AbortController()
  activeController = controller
  void runExport(event.data, controller.signal)
    .catch((error: unknown) => {
      const canceled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
      post({ type: 'error', message: canceled ? '视频导出已取消' : error instanceof Error ? error.message : String(error), canceled })
    })
    .finally(() => {
      activeController = null
    })
}
