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

interface VideoSourceState {
  source: WebGpuVideoExportSourceMessage
  input: MediabunnyInput
  track: MediabunnyVideoTrack
  sink: MediabunnyVideoSink
  firstTimestamp: number
  duration: number
}

const workerScope = globalThis as unknown as WorkerScope
let activeController: AbortController | null = null

function post(message: WebGpuVideoExportWorkerResponse, transfer?: Transferable[]): void {
  workerScope.postMessage(message, transfer)
}

function abortError(): DOMException {
  return new DOMException('视频导出已取消', 'AbortError')
}

function checkCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
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
): number {
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
  signal: AbortSignal
}): Promise<void> {
  if (!params.audioTrack) return
  const sink = new params.mediabunny.EncodedPacketSink(params.audioTrack)
  const decoderConfig = await params.audioTrack.getDecoderConfig()
  const firstTimestamp = await params.audioTrack.getFirstTimestamp()
  for await (const packet of sink.packets()) {
    checkCanceled(params.signal)
    await params.audioSource.add(
      packet.clone({ timestamp: Math.max(0, packet.timestamp - firstTimestamp) }),
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
        sink: new mediabunny.VideoSampleSink(track),
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
    BufferTarget,
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
  if (!primaryLayer) throw new Error('WebGPU 视频导出缺少视频图层')
  const primaryKey = sourceKeyForLayer(primaryLayer)
  const primaryState = videoStates.get(primaryKey)
  if (!primaryState) throw new Error(`视频源尚未传入: ${primaryKey}`)

  const imageSources = new Map(
    message.sources
      .filter((source) => source.sourceType === 'image')
      .map((source) => [source.path, source]),
  )
  const imageBitmaps = new Map<string, ImageBitmap>()
  const inputDuration = primaryState.duration
  const duration = message.composition.canvas.duration != null
    && Number.isFinite(message.composition.canvas.duration)
    && message.composition.canvas.duration > 0
    ? message.composition.canvas.duration
    : inputDuration
  const packetStats = await primaryState.track.computePacketStats(60)
  const fps = Math.max(1, Math.min(120, message.fps ?? (packetStats.averagePacketRate || 30)))
  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  const bitrate = bitrateForPreset(message.qualityPreset, message.width, message.height, fps)
  if (!(await canEncodeVideo('avc', { width: message.width, height: message.height, bitrate }))) {
    throw new Error('当前 Electron 没有可用的视频编码器')
  }

  let output: InstanceType<typeof Output> | null = null
  let renderer: WebGpuCompositionRenderer | null = null
  let completed = false
  let runtimeError: Error | null = null
  const currentFrames = new Map<string, VideoFrame>()

  try {
    const format = new Mp4OutputFormat({ fastStart: 'in-memory' })
    const target = new BufferTarget()
    output = new Output({ format, target })
    const videoSource = new VideoSampleSource({
      codec: 'avc',
      bitrate,
      bitrateMode: 'variable',
      keyFrameInterval: 2,
      latencyMode: 'quality',
    })
    output.addVideoTrack(videoSource, { frameRate: fps })

    const audioTrack = message.includeAudio ? await primaryState.input.getPrimaryAudioTrack() : null
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null
    const audioCopied = Boolean(audioTrack && audioCodec && format.getSupportedAudioCodecs().includes(audioCodec))
    const audioSource = audioCopied ? new EncodedAudioPacketSource(audioCodec!) : null
    if (audioSource) output.addAudioTrack(audioSource)

    postProgress('preparing', 8, 0, totalFrames, `${message.width} x ${message.height}，${fps.toFixed(2)} FPS，${videoStates.size} 个视频源`)
    checkCanceled(signal)
    await output.start()

    const audioTask = audioSource && audioTrack
      ? copyAudioPackets({ mediabunny, audioTrack, audioSource, signal })
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

      const primaryFrame = currentFrames.get(primaryKey)
      if (!primaryFrame) {
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
        try {
          postProgress('rendering', 10 + (frameCount / totalFrames) * 82, frameCount, totalFrames, `渲染并编码第 ${frameCount + 1} 帧`)
          await videoSource.add(outputSample)
        } finally {
          outputSample.close()
        }
      } finally {
        closeFrames(currentFrames)
        for (const sample of samples) sample?.close()
      }
      frameCount += 1
    }

    checkCanceled(signal)
    postProgress('finalizing', 94, frameCount, totalFrames, '等待编码和音频完成')
    if (audioTask) await audioTask
    checkCanceled(signal)
    await output.finalize()
    completed = true
    if (!target.buffer) throw new Error('编码器没有生成输出文件')
    post({
      type: 'done',
      buffer: target.buffer,
      duration,
      frameCount,
      audioCopied,
    }, [target.buffer])
  } finally {
    closeFrames(currentFrames)
    renderer?.destroy()
    for (const bitmap of imageBitmaps.values()) bitmap.close()
    for (const state of videoStates.values()) state.input.dispose()
    if (output && !completed) await output.cancel().catch(() => undefined)
  }
}

workerScope.onmessage = (event) => {
  if (event.data.type === 'cancel') {
    activeController?.abort()
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
