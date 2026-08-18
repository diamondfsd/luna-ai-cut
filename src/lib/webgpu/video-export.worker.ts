import { WebGpuCompositionRenderer } from './composition'
import type {
  WebGpuVideoExportProgressMessage,
  WebGpuVideoExportStartMessage,
  WebGpuVideoExportWorkerMessage,
  WebGpuVideoExportWorkerResponse,
} from './video-export-protocol'

type MediabunnyModule = typeof import('mediabunny')

interface WorkerScope {
  onmessage: ((event: MessageEvent<WebGpuVideoExportWorkerMessage>) => void) | null
  postMessage(message: WebGpuVideoExportWorkerResponse, transfer?: Transferable[]): void
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

async function copyAudioPackets(params: {
  mediabunny: MediabunnyModule
  audioTrack: Awaited<ReturnType<InstanceType<MediabunnyModule['Input']>['getPrimaryAudioTrack']>>
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

async function runExport(message: WebGpuVideoExportStartMessage, signal: AbortSignal): Promise<void> {
  const mediabunny: MediabunnyModule = await import('mediabunny')
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    EncodedAudioPacketSource,
    Input,
    Mp4OutputFormat,
    Output,
    VideoSample,
    VideoSampleSink,
    VideoSampleSource,
    canEncodeVideo,
  } = mediabunny

  postProgress('preparing', 2, 0, 0, '准备视频导出')
  checkCanceled(signal)

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([message.bytes], { type: message.mimeType })),
  })
  let output: InstanceType<typeof Output> | null = null
  let renderer: WebGpuCompositionRenderer | null = null
  let completed = false
  let currentFrame: VideoFrame | null = null
  let runtimeError: Error | null = null

  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) throw new Error('文件中没有可导出的视频轨道')
    const duration = await videoTrack.computeDuration()
    const packetStats = await videoTrack.computePacketStats(60)
    const fps = Math.max(1, Math.min(120, message.fps ?? (packetStats.averagePacketRate || 30)))
    const totalFrames = Math.max(1, Math.ceil(duration * fps))
    const bitrate = bitrateForPreset(message.qualityPreset, message.width, message.height, fps)
    if (!(await canEncodeVideo('avc', { width: message.width, height: message.height, bitrate }))) {
      throw new Error('当前 Electron 没有可用的视频编码器')
    }

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

    const audioTrack = message.includeAudio ? await input.getPrimaryAudioTrack() : null
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null
    const audioCopied = Boolean(audioTrack && audioCodec && format.getSupportedAudioCodecs().includes(audioCodec))
    const audioSource = audioCopied ? new EncodedAudioPacketSource(audioCodec!) : null
    if (audioSource) output.addAudioTrack(audioSource)

    postProgress('preparing', 8, 0, totalFrames, `${message.width} x ${message.height}，${fps.toFixed(2)} FPS`)
    checkCanceled(signal)
    await output.start()

    const audioTask = audioSource && audioTrack
      ? copyAudioPackets({ mediabunny, audioTrack, audioSource, signal })
      : null
    const videoSink = new VideoSampleSink(videoTrack)
    const firstTimestamp = await videoTrack.getFirstTimestamp()
    renderer = new WebGpuCompositionRenderer(new OffscreenCanvas(message.width, message.height))
    await renderer.initialize({
      resolveImage: async () => {
        throw new Error('当前 WebGPU 视频导出不支持静态图层')
      },
      resolveSource: async () => {
        if (!currentFrame) throw new Error('视频帧尚未准备好')
        return currentFrame
      },
      onDeviceLost: (error) => { runtimeError = new Error(error) },
      onError: (error) => { runtimeError = new Error(error) },
    })

    let frameCount = 0
    postProgress('decoding', 10, 0, totalFrames, '开始逐帧读取视频')
    for await (const sample of videoSink.samples()) {
      checkCanceled(signal)
      if (runtimeError) throw runtimeError
      if (sample.timestamp + sample.duration <= firstTimestamp) {
        sample.close()
        continue
      }

      currentFrame = sample.toVideoFrame()
      try {
        const compositionTime = Math.max(0, sample.timestamp - firstTimestamp)
        await renderer.render(message.composition, compositionTime)
        await renderer.waitForGpu()
        if (runtimeError) throw runtimeError
        const outputSample = new VideoSample(renderer.canvas, {
          timestamp: compositionTime,
          duration: sample.duration || 1 / fps,
        })
        try {
          postProgress('rendering', 10 + (frameCount / totalFrames) * 82, frameCount, totalFrames, `渲染并编码第 ${frameCount + 1} 帧`)
          await videoSource.add(outputSample, sample.encodeOptions)
        } finally {
          outputSample.close()
        }
      } finally {
        currentFrame.close()
        currentFrame = null
        sample.close()
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
    currentFrame?.close()
    renderer?.destroy()
    if (output && !completed) await output.cancel().catch(() => undefined)
    input.dispose()
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
