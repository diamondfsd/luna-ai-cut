/**
 * Luna 统一导出服务
 *
 * 所有导出（图片/视频 + 水印）统一入口：
 *   下载（如需）→ Native Core renderFrame → FFmpeg encode → 输出
 *
 * 回调：onProgress / onStatus / onCancel
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { createRequire } from 'node:module'
import { watermarkFileFor } from './watermarkService'

const _require = createRequire(import.meta.url)

// ── Native Core 接口 ──

interface RenderLayer {
  textureId: number; dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
}

interface LunaRC {
  initCompositor(logPath?: string): void
  loadTexture(data: Buffer, w: number, h: number): number
  updateTexture(id: number, data: Buffer): void
  releaseTexture(id: number): void
  renderFrame(w: number, h: number, layers: RenderLayer[]): Buffer
  exportVideo(ffmpeg: string, ffprobe: string, input: string, output: string,
    cw: number, ch: number, fps: number | null, hw: boolean,
    videoLayer: RenderLayer, overlays: RenderLayer[]): void
  destroyCompositor(): void
}

let _lrc: LunaRC | null = null
function getLRC(): LunaRC {
  if (_lrc) return _lrc
  const root = process.env.APP_ROOT || join(import.meta.dirname, '..')
  _lrc = _require(join(root, 'luna-render-core', 'luna-render-core.node')) as LunaRC
  _lrc.initCompositor()
  return _lrc
}

// ── 日志 ──

let _logPath = ''
function log(msg: string) {
  try {
    const ts = new Date().toISOString().slice(11, 23)
    if (_logPath) appendFileSync(_logPath, `[${ts}] [export] ${msg}\n`)
  } catch {}
}

// ── 类型 ──

export type ExportStatus = 'queued' | 'downloading' | 'rendering' | 'done' | 'failed' | 'canceled'

export interface ExportState {
  id: string
  fileName: string
  status: ExportStatus
  progress: number
  error?: string
  outputPath?: string
}

export interface ExportInput {
  id: string
  kind: 'image' | 'video'
  localPath?: string | null
  watermark?: { enabled: boolean; style: string; position: string; overlayPath?: string } | null
  outputDir: string
  outputName?: string
  canvasW?: number; canvasH?: number; fps?: number
  /** 由主进程在 IPC handler 中解析后传入 */
  ffmpegPath: string
  ffprobePath: string
  logPath?: string
}

export interface ExportCallbacks {
  onProgress: (state: ExportState) => void
  signal: AbortSignal
}

// ═══════════════════════════════════════════
//  统一入口
// ═══════════════════════════════════════════

export async function runExport(input: ExportInput, cb: ExportCallbacks): Promise<ExportState> {
  if (input.logPath) _logPath = input.logPath

  const state: ExportState = { id: input.id, fileName: input.outputName || 'export', status: 'queued', progress: 0 }
  const emit = (s: ExportStatus, p: number, extra?: Partial<ExportState>) => {
    Object.assign(state, { status: s, progress: p, ...extra })
    cb.onProgress({ ...state })
  }

  try {
    if (cb.signal.aborted) return state
    const filePath = input.localPath || ''
    if (!filePath || !existsSync(filePath)) {
      emit('failed', 100, { error: '文件不存在' })
      return state
    }

    // ── 2. 导出 ──
    const outName = input.outputName || basename(filePath).replace(extname(filePath), '_wm' + extname(filePath))
    const outPath = join(input.outputDir, outName)

    log(`[${input.id}] export ${filePath} → ${outPath} kind=${input.kind}`)

    if (input.kind === 'image') {
      await exportImage(filePath, outPath, input, cb, emit)
    } else {
      await exportVideo(filePath, outPath, input, cb, emit)
    }

    if (!state.error) {
      emit('done', 100, { outputPath: outPath })
    }
    return state
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('cancel') || cb.signal.aborted) {
      emit('canceled', 100)
    } else {
      log(`[${input.id}] ERROR: ${msg}`)
      log(`[${input.id}] ERROR: ${msg}`)
      emit('failed', 100, { error: msg })
    }
    return state
  }
}

// ═══════════════════════════════════════════
//  图片导出
// ═══════════════════════════════════════════

async function exportImage(
  inputPath: string, outPath: string, input: ExportInput,
  cb: ExportCallbacks, emit: (s: ExportStatus, p: number, e?: Partial<ExportState>) => void,
): Promise<void> {
  if (!input.watermark?.enabled) {
    // 无水印 → 直接复制
    const { copyFile } = await import('node:fs/promises')
    await copyFile(inputPath, outPath)
    return
  }

  emit('rendering', 30)
  if (cb.signal.aborted) return

  try {
    const lrc = getLRC()

    // 解码图片到 RGBA（用 FFmpeg）
    const rgba = await decodeImageToRGBA(inputPath, input.ffmpegPath, input.ffprobePath)
    if (!rgba) throw new Error('图片解码失败')

    const lrcLayers: RenderLayer[] = [
      { textureId: 1, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 },
    ]

    // 水印
    if (input.watermark.enabled) {
      const wmPath = watermarkFileFor('image', input.watermark.style)
      const wmRgba = existsSync(wmPath) ? await decodeImageToRGBA(wmPath, input.ffmpegPath, input.ffprobePath) : null
      if (wmRgba) {
        // 水印尺寸和位置（归一化）
        const margin = 0.03; const wmW = 0.2
        const wmAspect = wmRgba.height / wmRgba.width
        const wmH = wmW * wmAspect * (rgba.width / rgba.height)
        let x: number, y: number
        const pos = input.watermark.position
        if (pos === 'bottom-right') { x = 1 - wmW - margin; y = 1 - wmH - margin }
        else if (pos === 'top-left') { x = margin; y = margin }
        else if (pos === 'bottom-left') { x = margin; y = 1 - wmH - margin }
        else { x = (1 - wmW) / 2; y = (1 - wmH) / 2 }  // center default

        const wmTexId = lrc.loadTexture(wmRgba.data, wmRgba.width, wmRgba.height)
        lrcLayers.push({ textureId: wmTexId, dstX: x, dstY: y, dstW: wmW, dstH: wmH, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 0.85, zIndex: 10 })
      }
    }

    // 加载图片纹理
    const imgTexId = lrc.loadTexture(rgba.data, rgba.width, rgba.height)

    emit('rendering', 70)
    const result = lrc.renderFrame(rgba.width, rgba.height, lrcLayers)

    // 保存 PNG
    await encodeImageFromRGBA(result, rgba.width, rgba.height, outPath, input.ffmpegPath)

    lrc.releaseTexture(imgTexId)
    log(`[${input.id}] image done: ${outPath}`)
  } catch (err) {
    throw err
  }
}

// ═══════════════════════════════════════════
//  视频导出
// ═══════════════════════════════════════════

async function exportVideo(
  inputPath: string, outPath: string, input: ExportInput,
  cb: ExportCallbacks, emit: (s: ExportStatus, p: number, e?: Partial<ExportState>) => void,
): Promise<void> {
  emit('rendering', 20)
  if (cb.signal.aborted) return

  const lrc = getLRC()
  const ffmpeg = input.ffmpegPath
  const ffprobe = input.ffprobePath

  const cw = input.canvasW || 1920
  const ch = input.canvasH || 1080

  const videoLayer: RenderLayer = { textureId: 0, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }
  const overlays: RenderLayer[] = []

  if (input.watermark?.enabled) {
    const wmPath = watermarkFileFor('video', input.watermark.style)
    if (existsSync(wmPath)) {
      const wmRgba = await decodeImageToRGBA(wmPath, input.ffmpegPath, input.ffprobePath)
      if (wmRgba) {
        const wmTexId = lrc.loadTexture(wmRgba.data, wmRgba.width, wmRgba.height)
        const margin = 0.03; const wmW = 0.2
        const wmAspect = wmRgba.height / wmRgba.width
        const wmH = wmW * wmAspect * (cw / ch)
        overlays.push({ textureId: wmTexId, dstX: 1 - wmW - margin, dstY: 1 - wmH - margin, dstW: wmW, dstH: wmH, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 0.85, zIndex: 10 })
      }
    }
  }

  // 调用 Native Core 导出视频（内部 spawn FFmpeg decode → wgpu → FFmpeg encode）
  lrc.exportVideo(ffmpeg, ffprobe, inputPath, outPath, cw, ch, input.fps ?? null, true, videoLayer, overlays)

  // 清理水印纹理
  for (const ol of overlays) { lrc.releaseTexture(ol.textureId) }

  log(`[${input.id}] video done: ${outPath}`)
}

// ═══════════════════════════════════════════
//  工具：FFmpeg 图片解码/编码
// ═══════════════════════════════════════════

interface ImageRGBA {
  data: Buffer
  width: number
  height: number
}

async function decodeImageToRGBA(filePath: string, ffmpeg: string, ffprobe: string): Promise<ImageRGBA | null> {
  const { promisify } = await import('node:util')
  const { execFile } = await import('node:child_process')
  const execAsync = promisify(execFile)

  try {
    const { stdout } = await execAsync(ffprobe, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', filePath,
    ], { timeout: 10000 })
    const info = JSON.parse(stdout)
    const vs = info.streams?.find((s: any) => s.codec_type === 'video')
    if (!vs) return null
    const w = vs.width || 1920
    const h = vs.height || 1080

    return new Promise((resolve) => {
      const proc = spawn(ffmpeg, [
        '-i', filePath, '-f', 'rawvideo', '-pix_fmt', 'rgba',
        '-s', `${w}x${h}`, '-vframes', '1', 'pipe:1',
        '-loglevel', 'error',
      ])
      const chunks: Buffer[] = []
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      proc.on('close', (code) => {
        if (code === 0) resolve({ data: Buffer.concat(chunks), width: w, height: h })
        else resolve(null)
      })
      proc.on('error', () => resolve(null))
    })
  } catch {
    return null
  }
}

async function encodeImageFromRGBA(data: Buffer, width: number, height: number, outPath: string, ffmpeg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
      '-i', 'pipe:0', '-frames:v', '1', outPath, '-y', '-loglevel', 'error',
    ])
    proc.stdin.write(data)
    proc.stdin.end()
    proc.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(`ffmpeg exit ${code}`)) })
    proc.on('error', reject)
  })
}
