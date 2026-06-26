import * as path from 'node:path'
import { app } from 'electron'
import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'
import type { WatermarkPosition, WatermarkSize, WatermarkStyle } from '../../src/shared/types'

/** 水印尺寸比例 */
const WATERMARK_SCALE: Record<WatermarkSize, number> = {
  small: 0.08,
  medium: 0.12,
  large: 0.18,
}

function getWatermarkDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'watermark')
  return path.join(app.getAppPath(), 'src', 'assets', 'watermark')
}

function watermarkFileFor(style: WatermarkStyle): string {
  const filenames: Record<WatermarkStyle, string> = {
    luna_ultra: 'ic_watermark_luna_ultra.png',
    luna_ultra_cn: 'ic_watermark_luna_ultra_cn.png',
  }
  return path.join(getWatermarkDir(), filenames[style])
}

/** 根据水印位置生成 FFmpeg overlay 表达式 */
function overlayExpr(vPos: string, hPos: string, margin: number): [string, string] {
  const x = hPos === 'left' ? String(margin)
    : hPos === 'right' ? `(W-w-${margin})`
    : '(W-w)/2'
  const y = vPos === 'bottom' ? `(H-h-${margin})` : String(margin)
  return [x, y]
}

export interface WatermarkOptions {
  size: WatermarkSize
  position: WatermarkPosition
  style: WatermarkStyle
}

/**
 * 水印模块 — 叠加水印图片到视频
 */
export class WatermarkModule implements FfmpegModule {
  readonly name = 'watermark'
  private opts: WatermarkOptions

  constructor(opts: WatermarkOptions) {
    this.opts = opts
  }

  isActive(): boolean {
    return true
  }

  build(ctx: BuildContext): ModuleArgs {
    const { size, position, style } = this.opts
    const wmPath = watermarkFileFor(style)

    // 水印大小和边距基于输出分辨率计算（考虑 ScaleModule 已缩放）
    const outputW = ctx.outputWidth
    const wmSize = Math.round(outputW * WATERMARK_SCALE[size])
    const marginPx = Math.round(outputW * 0.03)
    const [vPos, hPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
    const [ox, oy] = overlayExpr(vPos, hPos, marginPx)

    console.log('[LIVE watermark VID]', {
      outputWidth: ctx.outputWidth, outputHeight: ctx.outputHeight,
      probeVideoWidth: ctx.probe.videoWidth,
      wmSize, marginPx,
      position, overlayExpr: `${ox}:${oy}`,
      prevLabel: ctx.prevLabel,
    })

    return {
      inputs: [wmPath],
      filters: [
        `[1:v]scale=${wmSize}:-1[wm];${ctx.prevLabel}[wm]overlay=${ox}:${oy}`,
      ],
    }
  }
}
