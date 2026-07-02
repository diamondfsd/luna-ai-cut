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

export async function exportVideoWithWebGL(options: VideoExportOptions): Promise<void> {
  const { sourcePath, pipeline, exportId, taskName, onProgress } = options

  logger.info('[videoExport] step1 创建video元素', { sourcePath })

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
  logger.info('[videoExport] step2 视频元数据加载完成', { width, height, duration })

  const fps = await getVideoFps(sourcePath)
  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  const frameDuration = 1 / fps
  logger.info('[videoExport] step3 获取帧率', { fps, totalFrames, frameDuration })

  // 2. 启动编码器
  logger.info('[videoExport] step4 启动ffmpeg编码器')
  let encoder
  try {
    encoder = await window.luna.workspace.startVideoExport({
      exportId, taskName, outputName: sourcePath, width, height, fps,
    })
    logger.info('[videoExport] step4 编码器启动成功', { outputPath: encoder.outputPath })
  } catch (err) {
    logger.error('[videoExport] step4 编码器启动失败', { err: String(err) })
    throw err
  }
  const outputPath = encoder.outputPath

  // 3. 离屏 WebGL
  logger.info('[videoExport] step5 创建WebGL渲染器')
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
    logger.info('[videoExport] step6 开始逐帧导出', { totalFrames })
    const t0 = Date.now()

    for (let frame = 0; frame < totalFrames; frame++) {
      // seek
      const seekT0 = Date.now()
      const time = Math.min(frame * frameDuration, duration - 0.001)
      video.currentTime = time
      await waitForSeeked(video)
      const seekCost = Date.now() - seekT0

      // render
      renderer.render(pipeline)
      renderer.readPixelsInto(pixels)
      for (let y = 0; y < height; y++) {
        flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
      }

      // IPC（首帧附带进度元数据）
      const ipcT0 = Date.now()
      const frameMeta = frame === 0 ? { totalFrames, taskId: encoder.taskId, taskStart: encoder.taskStart } : undefined
      await window.luna.workspace.sendVideoExportFrame(exportId, flipped.buffer as ArrayBuffer, frameMeta)
      const ipcCost = Date.now() - ipcT0

      // 进度
      const pct = Math.round(((frame + 1) / totalFrames) * 100)
      if (pct >= lastReportedPct + 2 || pct === 100) {
        lastReportedPct = pct
        logger.info('[videoExport] 进度', { frame, totalFrames, pct, seekCost, ipcCost, elapsed: Date.now() - t0 })
        onProgress?.(pct)
      }

      // yield
      if (frame > 0 && frame % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }

    logger.info('[videoExport] step7 所有帧处理完成', { totalFrames, elapsed: Date.now() - t0 })
  } catch (err) {
    logger.error('[videoExport] 导出异常', { err: String(err) })
    throw err
  } finally {
    renderer.destroy()
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }

  // 5. 结束编码
  logger.info('[videoExport] step8 结束编码')
  let result
  try {
    result = await window.luna.workspace.endVideoExport(exportId, {
      taskId: encoder.taskId,
      taskStart: encoder.taskStart,
      outputPath,
    })
    logger.info('[videoExport] step8 编码结束', { result })
  } catch (err) {
    logger.error('[videoExport] step8 编码结束失败', { err: String(err) })
    throw err
  }
}
