import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'

export interface ColorGradingOptions {
  exposure: number   // -100 ~ 100
  black: number      // -100 ~ 100
  brightness: number // -100 ~ 100
  temperature: number // -100 ~ 100
  tint: number       // -100 ~ 100
  contrast: number   // -100 ~ 100
  saturation: number // -100 ~ 100
  vibrance: number   // -100 ~ 100
  shadows: number    // -100 ~ 100
  highlights: number // -100 ~ 100
  whites: number     // -100 ~ 100
  blacks: number     // -100 ~ 100
  clarity: number    // -100 ~ 100
  sharpen: number    // 0 ~ 100
  denoise: number    // 0 ~ 100
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * 调色模块 — 将 EditPipeline.color 参数映射为 ffmpeg filter 链。
 *
 * 所有滤镜用逗号串联成一条 filter_complex 表达式，最后不标输出标签，
 * 让 ffmpeg 自动映射到输出流（避免 "has an unconnected output" 错误）。
 */
export class ColorGradingModule implements FfmpegModule {
  readonly name = 'colorGrading'
  private opts: ColorGradingOptions

  constructor(opts: ColorGradingOptions) {
    this.opts = opts
  }

  isActive(): boolean {
    const o = this.opts
    return (
      o.exposure !== 0 || o.black !== 0 || o.brightness !== 0 ||
      o.temperature !== 0 || o.tint !== 0 ||
      o.contrast !== 0 || o.saturation !== 0 || o.vibrance !== 0 ||
      o.shadows !== 0 || o.highlights !== 0 || o.whites !== 0 || o.blacks !== 0 ||
      o.clarity !== 0 || o.sharpen !== 0 || o.denoise !== 0
    )
  }

  build(ctx: BuildContext): ModuleArgs {
    const o = this.opts
    const parts: string[] = []

    // ── eq: exposure / brightness / contrast / saturation ──
    const eqParts: string[] = []
    if (o.exposure !== 0) {
      eqParts.push(`gamma=${(1 + clamp(o.exposure, -100, 100) / 200).toFixed(3)}`)
    }
    if (o.brightness !== 0) {
      eqParts.push(`brightness=${(clamp(o.brightness, -100, 100) / 100).toFixed(3)}`)
    }
    if (o.contrast !== 0) {
      eqParts.push(`contrast=${(1 + clamp(o.contrast, -100, 100) / 100).toFixed(3)}`)
    }
    if (o.saturation !== 0) {
      eqParts.push(`saturation=${(1 + clamp(o.saturation, -100, 100) / 100).toFixed(3)}`)
    }
    if (eqParts.length > 0) {
      parts.push(`eq=${eqParts.join(':')}`)
    }

    // ── vibrance ──
    if (o.vibrance !== 0) {
      parts.push(`vibrance=${(clamp(o.vibrance, -100, 100) / 100).toFixed(3)}`)
    }

    // ── 色温 / 色调 ──
    const wbParts: string[] = []
    if (o.temperature !== 0) {
      const kelvin = Math.round(5500 - clamp(o.temperature, -100, 100) * 30)
      wbParts.push(`colortemperature=${kelvin}`)
    }
    if (o.tint !== 0) {
      wbParts.push(`hue=H=${(clamp(o.tint, -100, 100) * 0.08).toFixed(2)}`)
    }
    if (wbParts.length > 0) {
      parts.push(wbParts.join(','))
    }

    // ── 色调均衡（colorbalance：shadows / highlights）──
    const cbParts: string[] = []
    if (o.shadows !== 0) {
      const val = (clamp(o.shadows, -100, 100) / 100 * 0.15).toFixed(3)
      cbParts.push(`rs=${val}:gs=${val}:bs=${val}`)
    }
    if (o.highlights !== 0) {
      const val = (clamp(o.highlights, -100, 100) / 100 * 0.15).toFixed(3)
      cbParts.push(`rh=${val}:gh=${val}:bh=${val}`)
    }
    if (cbParts.length > 0) {
      parts.push(`colorbalance=${cbParts.join(':')}`)
    }

    // ── 黑/白色阶（colorlevels）──
    const clParts: string[] = []
    if (o.blacks !== 0) {
      const val = (clamp(o.blacks, -100, 100) / 100 * -0.15).toFixed(3)
      clParts.push(`rimin=${val}:gimin=${val}:bimin=${val}`)
    }
    if (o.whites !== 0) {
      const val = (clamp(o.whites, -100, 100) / 100 * 0.15).toFixed(3)
      clParts.push(`rimax=${val}:gimax=${val}:bimax=${val}`)
    }
    if (clParts.length > 0) {
      parts.push(`colorlevels=${clParts.join(':')}`)
    }

    // ── 清晰度 / 锐化（unsharp）──
    const usParts: string[] = []
    if (o.clarity !== 0) {
      const amount = clamp(o.clarity, -100, 100) / 100
      usParts.push(`luma_msize_x=9:luma_msize_y=9:luma_amount=${amount.toFixed(3)}`)
    }
    if (o.sharpen !== 0) {
      const amount = clamp(o.sharpen, 0, 100) / 100 * 2
      usParts.push(`luma_msize_x=3:luma_msize_y=3:luma_amount=${amount.toFixed(3)}`)
    }
    if (usParts.length > 0) {
      parts.push(`unsharp=${usParts.join(':')}`)
    }

    // ── 降噪（hqdn3d）──
    if (o.denoise !== 0) {
      const s = clamp(o.denoise, 0, 100) / 100 * 6
      parts.push(`hqdn3d=${s.toFixed(2)}:${s.toFixed(2)}:${(s * 0.5).toFixed(2)}:${(s * 0.5).toFixed(2)}`)
    }

    // 所有滤镜以逗号串联，末尾不加标签 → ffmpeg 自动映射输出
    const filter = `${ctx.prevLabel}${parts.join(',')}`
    return {
      filters: [filter],
      // 不设 outputLabel — 下游模块或 ffmpeg 自动连接
    }
  }
}
