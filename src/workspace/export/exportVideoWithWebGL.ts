import type { EditPipeline } from '../shared/editPipeline'
import { WebGLRenderer } from '../renderer/webglRenderer'
import { filePathToLunaFile, filePathToPreviewUrl } from '../../components/previewModalUtils'
import { logger } from '../../lib/rendererLogger'

interface VideoExportOptions {
  sourcePath: string
  pipeline: EditPipeline
  exportId: string
  taskName: string
  onProgress?: (percent: number) => void
}

function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  if (video.seeking) {
    return new Promise((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true })
    })
  }
  return Promise.resolve()
}

/** 通过 ffmpeg 获取视频原始帧率 */
async function getVideoFps(sourcePath: string): Promise<number> {
  try {
    const lunaFile = filePathToLunaFile(sourcePath, { kind: 'video' })
    const frameRate = await window.luna.requestVideoFrameRate(lunaFile, sourcePath)
    return frameRate ?? 30
  } catch {
    return 30
  }
}

/**
 * 使用 WebGL shader 渲染视频每帧输出到 ffmpeg 仅编码（无色差滤镜参与）
 * 策略：按帧率 seek 每帧位置 → WebGL 渲染 → readPixels → IPC 发送到主进程
 */
export async function exportVideoWithWebGL(options: VideoExportOptions): Promise<void> {
  const { sourcePath, pipeline, exportId, taskName, onProgress } = options
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.playsInline = true
  const videoUrl = filePathToPreviewUrl(sourcePath) ?? `file://${sourcePath}`
  video.src = videoUrl

  // 等待元数据
  await new Promise<void>((resolve, reject) => {
    const onMeta = (): void => {
      if (video.duration > 0 && video.videoWidth > 0) resolve()
    }
    if (video.readyState >= 1) { onMeta(); return }
    video.addEventListener('loadedmetadata', onMeta, { once: true })
    video.addEventListener('error', () => reject(new Error('视频加载失败')), { once: true })
  })

  const width = video.videoWidth
  const height = video.videoHeight
  const duration = video.duration

  // 通过 ffmpeg 获取原始帧率
  const fps = await getVideoFps(sourcePath)

  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  const frameDuration = 1 / fps

  logger.info(`[videoExport] 开始逐帧导出`, { width, height, duration, fps, totalFrames })

  // 启动主进程编码器
  const encoder = await window.luna.workspace.startVideoExport({
    exportId, taskName, outputName: sourcePath,
    width, height, fps,
  })

  const outputPath = encoder.outputPath

  // 创建离屏 canvas + WebGL
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const renderer = new WebGLRenderer(canvas)

  try {
    // 加载视频到 WebGL
    renderer.loadVideo(video)
    renderer.resize(width, height)

    // 逐帧 seek + 渲染
    for (let frame = 0; frame < totalFrames; frame++) {
      const time = Math.min(frame * frameDuration, duration - 0.001)
      video.currentTime = time
      await waitForSeeked(video)

      // WebGL shader 渲染当前帧
      renderer.render(pipeline)

      // 读取像素（WebGL 原点在左下，需要翻转 Y）
      const pixels = renderer.readAllPixels()
      const stride = width * 4
      const flipped = new Uint8Array(pixels.length)
      for (let y = 0; y < height; y++) {
        flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
      }

      // IPC 发送到主进程 ffmpeg 编码器
      await window.luna.workspace.sendVideoExportFrame(exportId, flipped.buffer as ArrayBuffer)

      // 进度
      const pct = Math.round(((frame + 1) / totalFrames) * 100)
      onProgress?.(pct)
      window.luna.log('info', `[videoExport] 帧 ${frame + 1}/${totalFrames} (${pct}%)`)
    }
  } finally {
    renderer.destroy()
    video.remove()
  }

  // 结束编码，等待 ffmpeg 完成
  const result = await window.luna.workspace.endVideoExport(exportId, {
    taskId: encoder.taskId,
    taskStart: encoder.taskStart,
    outputPath,
  })

  logger.info(`[videoExport] 导出完成`, { result })
}
