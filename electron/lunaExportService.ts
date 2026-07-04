/**
 * Luna 统一导出服务 — JS 只构建 JSON，Rust 负责全部渲染
 */
import { appendFileSync, existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

// ── Native Core ──
interface StaticLayer { imagePath: string; dstX: number; dstY: number; dstW: number; dstH: number; srcX: number; srcY: number; srcW: number; srcH: number; opacity: number; zIndex: number }
interface RenderLayer { textureId: number; dstX: number; dstY: number; dstW: number; dstH: number; srcX: number; srcY: number; srcW: number; srcH: number; opacity: number; zIndex: number }
interface LunaRC {
  initCompositor(logPath?: string): void
  exportFile(ffmpeg: string, ffprobe: string, input: string, output: string,
    cw: number, ch: number, fps: number | null, hw: boolean,
    videoLayer: RenderLayer, staticLayers: StaticLayer[]): void
}

let _lrc: LunaRC | null = null
function getLRC(): LunaRC {
  if (_lrc) return _lrc
  _lrc = _require(join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'luna-render-core', 'luna-render-core.node')) as LunaRC
  return _lrc
}

let _logPath = ''
function log(msg: string) { try { if (_logPath) appendFileSync(_logPath, `[${new Date().toISOString().slice(11,23)}] [export] ${msg}\n`) } catch {} }

export type ExportStatus = 'queued' | 'downloading' | 'rendering' | 'done' | 'failed' | 'canceled'
export interface ExportState { id: string; fileName: string; status: ExportStatus; progress: number; error?: string; outputPath?: string }
export interface ExportInput {
  id: string; kind: 'image' | 'video'; localPath?: string | null
  watermark?: { enabled: boolean; style: string; position: string; overlayPath?: string } | null
  outputDir: string; outputName?: string; canvasW?: number; canvasH?: number; fps?: number
  ffmpegPath: string; ffprobePath: string; logPath?: string
}
export interface ExportCallbacks { onProgress: (s: ExportState) => void; signal: AbortSignal }

export async function runExport(input: ExportInput, cb: ExportCallbacks): Promise<ExportState> {
  if (input.logPath) _logPath = input.logPath
  log(`START ${input.kind} ${input.localPath} wm=${!!input.watermark?.enabled}`)

  const state: ExportState = { id: input.id, fileName: input.outputName || basename(input.localPath || 'export'), status: 'queued', progress: 0 }
  const emit = (s: ExportStatus, p: number, e?: Partial<ExportState>) => { Object.assign(state, { status: s, progress: p, ...e }); cb.onProgress({ ...state }) }

  try {
    if (cb.signal.aborted) return state
    const fp = input.localPath || ''
    if (!fp || !existsSync(fp)) { emit('failed', 100, { error: '文件不存在' }); return state }
    const outPath = join(input.outputDir, input.outputName || basename(fp).replace(extname(fp), '_wm' + extname(fp)))

    const lrc = getLRC()
    try { lrc.initCompositor() } catch {}

    // 构建 JSON：视频帧 + 静态层（Rust 内部加载渲染）
    const videoLayer: RenderLayer = { textureId: 0, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 }
    const staticLayers: StaticLayer[] = []

    if (input.watermark?.enabled && input.watermark.overlayPath && existsSync(input.watermark.overlayPath)) {
      const m = 0.03; const wmW = 0.2; const pos = input.watermark.position || 'bottom-right'
      let x: number, y: number
      if (pos === 'bottom-right') { x = 1 - wmW - m; y = 1 - wmW - m }
      else if (pos === 'top-left') { x = m; y = m }
      else if (pos === 'bottom-left') { x = m; y = 1 - wmW - m }
      else { x = (1 - wmW) / 2; y = (1 - wmW) / 2 }
      staticLayers.push({ imagePath: input.watermark.overlayPath, dstX: x, dstY: y, dstW: wmW, dstH: wmW, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 0.85, zIndex: 10 })
      log(`  static layer: ${input.watermark.overlayPath}`)
    }

    emit('rendering', 20)
    const cw = input.canvasW || 1920; const ch = input.canvasH || 1080

    // 一调搞定：Rust 内部 FFmpeg decode → wgpu render → FFmpeg encode
    lrc.exportFile(input.ffmpegPath, input.ffprobePath, fp, outPath, cw, ch, input.fps ?? null, true, videoLayer, staticLayers)

    emit('done', 100, { outputPath: outPath })
    log(`DONE: ${outPath}`)
    return state
  } catch (err: any) {
    const msg = err?.message || String(err)
    log(`ERROR: ${msg}`)
    if (msg.includes('cancel') || cb.signal.aborted) emit('canceled', 100)
    else emit('failed', 100, { error: msg })
    return state
  }
}
