import type { ColorGradeAdjustments, WebGpuColorRenderer } from './webgpu-color-grade'

export interface WebGpuVideoExportProgress {
  phase: 'preparing' | 'decoding' | 'rendering' | 'encoding' | 'finalizing'
  progress: number
  currentFrame: number
  totalFrames: number
  message: string
}

export interface WebGpuVideoExportResult {
  blob: Blob
  filename: string
  mimeType: string
  duration: number
  frameCount: number
  codec: 'avc' | 'vp9'
  audioCopied: boolean
}

export async function exportColorGradedVideo(params: {
  file: File
  renderer: WebGpuColorRenderer
  adjustments: ColorGradeAdjustments
  onProgress: (progress: WebGpuVideoExportProgress) => void
  signal?: AbortSignal
}): Promise<WebGpuVideoExportResult> {
  const mediabunny = await import('mediabunny')
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    EncodedAudioPacketSource,
    Input,
    InputVideoTrack,
    Mp4OutputFormat,
    Output,
    VideoSample,
    VideoSampleSink,
    VideoSampleSource,
    WebMOutputFormat,
    canEncodeVideo,
  } = mediabunny

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(params.file) })
  let output: InstanceType<typeof Output> | null = null
  let completed = false

  const checkCancelled = () => {
    if (params.signal?.aborted) throw new DOMException('视频导出已取消', 'AbortError')
  }

  try {
    params.onProgress({
      phase: 'preparing',
      progress: 2,
      currentFrame: 0,
      totalFrames: 0,
      message: '读取视频轨道',
    })
    checkCancelled()

    const videoTrack = await input.getPrimaryVideoTrack()
    if (!(videoTrack instanceof InputVideoTrack) && !videoTrack) {
      throw new Error('文件中没有可导出的视频轨道')
    }
    if (!videoTrack) throw new Error('文件中没有可导出的视频轨道')

    const width = videoTrack.displayWidth
    const height = videoTrack.displayHeight
    const duration = await videoTrack.computeDuration()
    const packetStats = await videoTrack.computePacketStats(60)
    const fps = Math.max(1, Math.min(120, packetStats.averagePacketRate || 30))
    const totalFrames = Math.max(1, Math.ceil(duration * fps))
    const bitrate = Math.max(4_000_000, Math.min(35_000_000, width * height * fps * 0.12))

    let codec: 'avc' | 'vp9' = 'avc'
    if (!(await canEncodeVideo('avc', { width, height, bitrate }))) {
      if (!(await canEncodeVideo('vp9', { width, height, bitrate }))) {
        throw new Error('当前环境没有可用的视频编码器')
      }
      codec = 'vp9'
    }
    const mimeType = codec === 'avc' ? 'video/mp4' : 'video/webm'
    const format = codec === 'avc'
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : new WebMOutputFormat()
    const target = new BufferTarget()
    output = new Output({ format, target })
    const videoSource = new VideoSampleSource({
      codec,
      bitrate,
      bitrateMode: 'variable',
      keyFrameInterval: 2,
      latencyMode: 'quality',
    })
    output.addVideoTrack(videoSource, { frameRate: fps })

    const audioTrack = await input.getPrimaryAudioTrack()
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null
    const audioCopied = Boolean(audioTrack && audioCodec && format.getSupportedAudioCodecs().includes(audioCodec))
    const audioSource = audioCopied
      ? new EncodedAudioPacketSource(audioCodec!)
      : null
    if (audioSource) output.addAudioTrack(audioSource)

    params.onProgress({
      phase: 'preparing',
      progress: 8,
      currentFrame: 0,
      totalFrames,
      message: `${width} x ${height}，${fps.toFixed(2)} FPS，${codec.toUpperCase()} 编码${audioCopied ? '，保留音频' : ''}`,
    })
    checkCancelled()
    await output.start()

    const audioTask = audioSource && audioTrack
      ? copyAudioPackets({
          audioTrack,
          audioSource,
          onProgress: (message) => params.onProgress({
            phase: 'encoding',
            progress: 8,
            currentFrame: 0,
            totalFrames,
            message,
          }),
          signal: params.signal,
        })
      : null

    const videoSink = new VideoSampleSink(videoTrack)
    const firstTimestamp = await videoTrack.getFirstTimestamp()
    let frameCount = 0

    params.onProgress({
      phase: 'decoding',
      progress: 10,
      currentFrame: 0,
      totalFrames,
      message: '开始逐帧解码',
    })

    for await (const sample of videoSink.samples()) {
      checkCancelled()
      if (sample.timestamp + sample.duration <= firstTimestamp) {
        sample.close()
        continue
      }

      const frame = sample.toVideoFrame()
      try {
        params.renderer.render(frame, params.adjustments)
        await params.renderer.waitForGpu()
      } finally {
        frame.close()
      }

      const timestamp = Math.max(0, sample.timestamp - firstTimestamp)
      const outputSample = new VideoSample(params.renderer.canvas, {
        timestamp,
        duration: sample.duration || 1 / fps,
      })
      try {
        params.onProgress({
          phase: 'rendering',
          progress: 10 + Math.round((frameCount / totalFrames) * 82),
          currentFrame: frameCount,
          totalFrames,
          message: `调色并编码第 ${frameCount + 1} 帧`,
        })
        await videoSource.add(outputSample, sample.encodeOptions)
      } finally {
        outputSample.close()
        sample.close()
      }
      frameCount += 1
    }

    params.onProgress({
      phase: 'finalizing',
      progress: 94,
      currentFrame: frameCount,
      totalFrames,
      message: '等待音频和编码器完成',
    })
    if (audioTask) await audioTask
    await output.finalize()
    completed = true

    if (!target.buffer) throw new Error('编码器没有生成输出文件')
    const extension = codec === 'avc' ? 'mp4' : 'webm'
    const filename = `${stripExtension(params.file.name)}-webgpu-grade.${extension}`
    const blob = new Blob([target.buffer], { type: mimeType })
    params.onProgress({
      phase: 'finalizing',
      progress: 100,
      currentFrame: frameCount,
      totalFrames,
      message: `导出完成，${formatBytes(blob.size)}`,
    })
    return { blob, filename, mimeType, duration, frameCount, codec, audioCopied }
  } catch (error) {
    if (output && !completed) await output.cancel().catch(() => undefined)
    throw error
  } finally {
    input.dispose()
  }
}

async function copyAudioPackets(params: {
  audioTrack: Awaited<ReturnType<InstanceType<typeof import('mediabunny')['Input']>['getPrimaryAudioTrack']>>
  audioSource: InstanceType<typeof import('mediabunny')['EncodedAudioPacketSource']>
  onProgress: (message: string) => void
  signal?: AbortSignal
}): Promise<void> {
  if (!params.audioTrack) return
  const sink = new (await import('mediabunny')).EncodedPacketSink(params.audioTrack)
  const decoderConfig = await params.audioTrack.getDecoderConfig()
  const metadata = decoderConfig ? { decoderConfig } : undefined
  for await (const packet of sink.packets()) {
    if (params.signal?.aborted) throw new DOMException('音频导出已取消', 'AbortError')
    await params.audioSource.add(packet.clone({ timestamp: packet.timestamp }), metadata)
    params.onProgress('复制音频包')
  }
  params.audioSource.close()
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || 'video'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
