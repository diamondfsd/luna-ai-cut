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

function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  if (video.seeking) {
    return new Promise((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true })
    })
  }
  return Promise.resolve()
}

/**
 * 逐帧 seek → WebGL shader 调色 → readPixels → IPC → ffmpeg 纯编码
 * 简捷可靠，不绕路
 */
export async function exportVideoWithWebGL(options: VideoExportOptions): Promise<void> {
  const { sourcePath, pipeline, exportId, taskName, onProgress } = options

  // 1. 加载视频元数据
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  video.src = filePathToPreviewUrl(sourcePath) ?? `file://${sourcePath}`

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
  const fps = await getVideoFps(sourcePath)
  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  const frameDuration = 1 / fps

  logger.info(`[videoExport] 逐帧导出 ${width}x${height}`, { fps, totalFrames })

  // 2. 启动编码器
  const encoder = await window.luna.workspace.startVideoExport({
    exportId, taskName, outputName: sourcePath, width, height, fps,
  })
  const outputPath = encoder.outputPath

  // 3. 离屏 WebGL（预分配缓冲，无 GC）
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const renderer = new WebGLRenderer(canvas)
  renderer.loadVideo(video)
  renderer.resize(width, height)

  const bufSize = width * height * 4
  const pixels = new Uint8Array(bufSize)
  const flipped = new Uint8Array(bufSize)
  const stride = width * 4

  let lastReportedPct = -1

  try {
    // 4. 逐帧 seek → 渲染 → IPC
    for (let frame = 0; frame < totalFrames; frame++) {
      const time = Math.min(frame * frameDuration, duration - 0.001)
      video.currentTime = time
      await waitForSeeked(video)

      // WebGL shader 渲染
      renderer.render(pipeline)

      // readPixels + Y 翻转
      renderer.readPixelsInto(pixels)
      for (let y = 0; y < height; y++) {
        flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
      }

      // IPC 发送到 ffmpeg 编码器
      await window.luna.workspace.sendVideoExportFrame(exportId, flipped.buffer as ArrayBuffer)

      // 进度（每 2% 或 100% 更新）
      const pct = Math.round(((frame + 1) / totalFrames) * 100)
      if (pct >= lastReportedPct + 2 || pct === 100) {
        lastReportedPct = pct
        onProgress?.(pct)
      }

      // 每 10 帧 yield 一次，防止 UI 卡死
      if (frame > 0 && frame % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  } finally {
    renderer.destroy()
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }

  // 5. 结束编码
  const result = await window.luna.workspace.endVideoExport(exportId, {
    taskId: encoder.taskId,
    taskStart: encoder.taskStart,
    outputPath,
  })
  logger.info(`[videoExport] 导出完成`, { result })
}
