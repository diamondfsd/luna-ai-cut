import * as path from 'node:path'
import { app } from 'electron'
import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'
import type { WatermarkPosition, WatermarkStyle } from '../../src/shared/types'
import { logExport } from '../loggerService'

type ConcreteWatermarkStyle = Exclude<WatermarkStyle, 'auto'>

function getWatermarkDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'watermark')
  return path.join(app.getAppPath(), 'src', 'assets', 'watermark')
}

function watermarkFileFor(style: string): string {
  return path.join(getWatermarkDir(), `ic_watermark_${style}.png`)
}

/** 根据水印位置生成 FFmpeg overlay 表达式 */
function overlayExpr(vPos: string, hPos: string, marginX: number, marginY: number): [string, string] {
  const x = hPos === 'left' ? String(marginX)
    : hPos === 'right' ? `(W-w-${marginX})`
    : '(W-w)/2'
  const y = vPos === 'bottom' ? `(H-h-${marginY})` : String(marginY)
  return [x, y]
}

export interface WatermarkOptions {
  /** 水印百分比（如 20 表示 20%） */
  watermarkPercent: number
  position: WatermarkPosition
  style: ConcreteWatermarkStyle
}

/**
 * 水印模块 — 叠加水印图片到视频
 * 支持 GPU overlay（overlay_cuda / overlay_qsv）自动插入 hwupload
 */
export class WatermarkModule implements FfmpegModule {
  readonly name = 'watermark'
  private opts: WatermarkOptions
  private overlayFilter: string

  constructor(opts: WatermarkOptions, overlayFilter: string = 'overlay') {
    this.opts = opts
    this.overlayFilter = overlayFilter
  }

  isActive(): boolean {
    return true
  }

  build(ctx: BuildContext): ModuleArgs {
    const { watermarkPercent, position, style } = this.opts
    const wmPath = watermarkFileFor(style)

    const outputW = ctx.outputWidth
    const outputH = ctx.outputHeight
    const wmSize = Math.round(outputW * watermarkPercent / 100)
    const marginX = Math.round(outputW * 0.03)
    const marginY = Math.round(outputH * 0.03)
    const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
    const [ox, oy] = overlayExpr(vPos, hPos, marginX, marginY)

    logExport('INFO', `[WATERMARK VID] 视频水印参数`, {
      outputWidth: outputW, outputHeight: outputH,
      probeVideoWidth: ctx.probe.videoWidth,
      wmSize, marginX, marginY,
      position, overlayExpr: `${ox}:${oy}`,
      prevLabel: ctx.prevLabel,
      overlayFilter: this.overlayFilter,
    })

    // GPU overlay（overlay_cuda / overlay_qsv）需要先将水印图片上传到 GPU
    // 注意：当前默认不使用 GPU overlay，详见 hwaccel.ts 中 nvidiaCuda/intelQsv 的注释
    let filter: string
    if (this.overlayFilter === 'overlay_cuda') {
      filter = `[1:v]scale=${wmSize}:-1,format=nv12,hwupload_cuda[wm];${ctx.prevLabel}[wm]overlay_cuda=${ox}:${oy}`
    } else if (this.overlayFilter === 'overlay_qsv') {
      filter = `[1:v]scale=${wmSize}:-1,format=nv12,hwupload=qsv[wm];${ctx.prevLabel}[wm]overlay_qsv=${ox}:${oy}`
    } else {
      // format=rgba 确保 PNG 透明通道被保留；overlay=:format=auto 自动选择输出格式
      filter = `[1:v]format=rgba,scale=${wmSize}:-1[wm];${ctx.prevLabel}[wm]overlay=${ox}:${oy}:format=auto`
    }

    return {
      inputs: [wmPath],
      filters: [filter],
    }
  }
}
