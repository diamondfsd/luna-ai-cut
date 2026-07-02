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

/**
 * 使用 WebGL shader 渲染视频每帧输出到 ffmpeg 仅编码（无色差滤镜参与）
 * 策略：以正常速度播放视频 → RAF 逐帧捕获 → WebGL 渲染 → readPixels → IPC
 * 替代逐帧 seek（seek 每帧重启解码器，极其缓慢）
 */
export async function exportVideoWithWebGL(options: VideoExportOptions): Promise<void> {
  const { sourcePath, pipeline, exportId, taskName, onProgress } = options

  // 1. 加载视频
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

  logger.info(`[videoExport] 开始`, { width, height, duration, fps, totalFrames })

  // 2. 启动主进程编码器
  const encoder = await window.luna.workspace.startVideoExport({
    exportId, taskName, outputName: sourcePath, width, height, fps,
  })
  const outputPath = encoder.outputPath

  // 3. 离屏 WebGL
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const renderer = new WebGLRenderer(canvas)
  const bufSize = width * height * 4
  const pixels = new Uint8Array(bufSize)
  // 翻转 ping-pong 缓冲（IPC 异步读取时避免写冲突）
  const flipBufs = [new Uint8Array(bufSize), new Uint8Array(bufSize)]
  let flipIdx = 0
  let ipcPending = Promise.resolve()
  const stride = width * 4

  let capturedCount = 0
  let lastReportedPct = -1
  let exportError: Error | null = null

  try {
    renderer.loadVideo(video)
    renderer.resize(width, height)

    // 4. 播放并逐帧捕获（play 方式比逐帧 seek 快 10x+）
    logger.info('[videoExport] 开始播放捕获')
    video.play()

    await new Promise<void>((resolve) => {
      video.addEventListener('ended', () => resolve(), { once: true })
      video.addEventListener('error', () => {
        exportError = new Error('视频播放失败')
        resolve()
      }, { once: true })

      let lastFrameIndex = -1

      const captureLoop = async (): Promise<void> => {
        if (video.paused || video.ended || exportError) return

        const currentFrame = Math.floor(video.currentTime / frameDuration)

        if (currentFrame > lastFrameIndex && currentFrame < totalFrames) {
          lastFrameIndex = currentFrame

          // 等待上一帧 IPC 完成
          await ipcPending

          // WebGL 渲染 → 读像素 → Y 翻转
          renderer.render(pipeline)
          renderer.readPixelsInto(pixels)
          const fb = flipBufs[flipIdx]
          for (let y = 0; y < height; y++) {
            fb.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
          }
          // IPC 发送（用 ping-pong 缓冲，避免写冲突）
          ipcPending = window.luna.workspace.sendVideoExportFrame(exportId, fb.buffer as ArrayBuffer)
            .catch((err: unknown) => { exportError = err instanceof Error ? err : new Error(String(err)) })
          flipIdx ^= 1

          capturedCount++
          const pct = Math.round((capturedCount / totalFrames) * 100)
          if (pct >= lastReportedPct + 2 || capturedCount >= totalFrames) {
            lastReportedPct = pct
            onProgress?.(pct)
          }
        }

        if (capturedCount < totalFrames) {
          requestAnimationFrame(captureLoop)
        } else {
          video.pause()
          resolve()
        }
      }

      requestAnimationFrame(() => { captureLoop().catch((e) => { exportError = e; resolve() }) })
    })

    if (exportError) throw exportError

    logger.info(`[videoExport] 播放捕获完成`, { capturedCount, totalFrames })

    // 5. 补帧：RAF 可能漏掉少量帧（尤其是播放结束前后），用 seek 补
    while (capturedCount < totalFrames) {
      const time = Math.min(capturedCount * frameDuration, duration - 0.001)
      video.currentTime = time
      if (video.seeking) {
        await new Promise((r) => video.addEventListener('seeked', r, { once: true }))
      }
      renderer.render(pipeline)
      renderer.readPixelsInto(pixels)
      const fb = flipBufs[flipIdx]
      for (let y = 0; y < height; y++) {
        fb.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
      }
      await window.luna.workspace.sendVideoExportFrame(exportId, fb.buffer as ArrayBuffer)
      flipIdx ^= 1
      capturedCount++
      const pct = Math.round((capturedCount / totalFrames) * 100)
      if (pct >= lastReportedPct + 2 || capturedCount >= totalFrames) {
        lastReportedPct = pct
        onProgress?.(pct)
      }
    }
  } finally {
    renderer.destroy()
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }

  // 6. 结束编码
  logger.info('[videoExport] 结束编码')
  const result = await window.luna.workspace.endVideoExport(exportId, {
    taskId: encoder.taskId,
    taskStart: encoder.taskStart,
    outputPath,
  })
  logger.info('[videoExport] 导出完成', { result })
}
