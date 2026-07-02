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

/**
 * 播放 + RAF 捕获绝大部分帧（0 seek 开销），少量漏帧用 seek 补
 * IPC 写 temp raw 文件（无背压），最后 ffmpeg 统一编码
 */
export async function exportVideoWithWebGL(options: VideoExportOptions): Promise<void> {
  const { sourcePath, pipeline, exportId, taskName, onProgress } = options

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

  logger.info(`[videoExport] 播放捕获模式 ${width}x${height}`, { fps, totalFrames })

  const encoder = await window.luna.workspace.startVideoExport({
    exportId, taskName, outputName: sourcePath, width, height, fps,
  })
  const outputPath = encoder.outputPath
  const rawFilePath = encoder.rawFilePath

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

  let capturedCount = 0
  let lastReportedPct = -1
  let ipcPending = Promise.resolve()

  try {
    // ── Phase 1: 播放捕获（0 seek 开销，捕获 95%+ 帧） ──
    logger.info('[videoExport] phase1 开始播放捕获')
    video.play()

    await new Promise<void>((resolve, reject) => {
      video.addEventListener('ended', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('视频播放失败')), { once: true })

      let lastFrameIndex = -1
      const frameMeta0 = { totalFrames, taskId: encoder.taskId, taskStart: encoder.taskStart, rawFilePath }

      const captureLoop = (): void => {
        if (video.paused || video.ended) return

        const currentFrame = Math.floor(video.currentTime / frameDuration)

        if (currentFrame > lastFrameIndex && currentFrame < totalFrames) {
          lastFrameIndex = currentFrame

          renderer.render(pipeline)
          renderer.readPixelsInto(pixels)
          for (let y = 0; y < height; y++) {
            flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
          }

          const meta = capturedCount === 0 ? frameMeta0 : undefined
          const buf = flipped.buffer as ArrayBuffer
          ipcPending = window.luna.workspace.sendVideoExportFrame(exportId, buf, meta)
            .catch((err: unknown) => logger.error('[videoExport] IPC失败', { err: String(err) }))

          capturedCount++
          if (capturedCount % 5 === 0) {
            const pct = Math.round((capturedCount / totalFrames) * 100)
            if (pct >= lastReportedPct + 2 || capturedCount >= totalFrames) {
              lastReportedPct = pct
              onProgress?.(pct)
            }
          }
        }

        requestAnimationFrame(captureLoop)
      }
      requestAnimationFrame(captureLoop)
    })

    video.pause()
    logger.info('[videoExport] phase1 完成', { capturedCount, totalFrames })

    // ── Phase 2: seek 补帧 ──
    await ipcPending
    while (capturedCount < totalFrames) {
      const time = Math.min(capturedCount * frameDuration, duration - 0.001)
      video.currentTime = time
      await waitForSeeked(video)
      renderer.render(pipeline)
      renderer.readPixelsInto(pixels)
      for (let y = 0; y < height; y++) {
        flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
      }
      await window.luna.workspace.sendVideoExportFrame(exportId, flipped.buffer as ArrayBuffer)
      capturedCount++
      const pct = Math.round((capturedCount / totalFrames) * 100)
      if (pct >= lastReportedPct + 2 || capturedCount >= totalFrames) {
        lastReportedPct = pct
        onProgress?.(pct)
        // 补帧阶段 yield
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

  // ── Phase 3: ffmpeg 编码 raw → mp4 ──
  logger.info('[videoExport] phase3 ffmpeg 编码 raw → mp4')
  onProgress?.(96)
  try {
    const result = await window.luna.workspace.endVideoExport(exportId, {
      taskId: encoder.taskId,
      taskStart: encoder.taskStart,
      outputPath, rawFilePath, width, height, fps,
    })
    logger.info('[videoExport] phase3 完成', { result })
    onProgress?.(100)
  } catch (err) {
    logger.error('[videoExport] phase3 编码失败', { err: String(err) })
    throw err
  }
}
