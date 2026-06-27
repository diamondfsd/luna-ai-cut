import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'

/** 预设码率映射（kbps 字符串，如 '50000k'） */
const QUALITY_BITRATES: Record<string, string> = {
  low: '5000k',
  medium: '20000k',
  high: '50000k',
}

export interface BitrateOptions {
  quality: string
  /** 自定义码率（kbps），仅 quality='custom' 时生效 */
  customBitrate?: number
  /**
   * 当 quality='original' 且硬件编码器启用时，设为 true
   * 硬件编码器（videotoolbox / nvenc / qsv / amf）不给 -b:v 会使用超保守默认值
   * 启用后将用源视频码率作为目标码率
   */
  useSourceBitrate?: boolean
}

/**
 * 码率模块 — 设置视频码率（预设或自定义）
 *
 * 特殊行为：当 quality='original' 且 useSourceBitrate=true 时，
 * 自动从 BuildContext.probe 获取源视频码率，确保硬件编码器不会用过低默认值
 */
export class BitrateModule implements FfmpegModule {
  readonly name = 'bitrate'
  private bitrate: string | null
  private useSourceBitrate: boolean

  constructor(opts: BitrateOptions) {
    this.useSourceBitrate = opts.useSourceBitrate ?? false

    if (opts.quality === 'original') {
      this.bitrate = null
    } else if (opts.quality === 'custom' && opts.customBitrate) {
      this.bitrate = `${opts.customBitrate}k`
    } else {
      this.bitrate = QUALITY_BITRATES[opts.quality] ?? null
    }
  }

  isActive(): boolean {
    return this.bitrate !== null || this.useSourceBitrate
  }

  build(ctx: BuildContext): ModuleArgs {
    let b: string

    if (this.useSourceBitrate && ctx.probe.videoBitrate) {
      // 硬件编码器需要显式码率——从源视频获取
      const kbps = Math.round(ctx.probe.videoBitrate / 1000)
      b = `${kbps}k`
    } else if (this.bitrate) {
      b = this.bitrate
    } else {
      return { outputArgs: [] }
    }

    const match = b.match(/^(\d+)([kKM]?)$/)
    const num = match ? parseInt(match[1]) : 0
    const suffix = match?.[2] ?? ''
    // -maxrate: useSourceBitrate 时给 2x 余量（尽可能保持原片画质）
    //           普通预设给 1.5x 余量（准确达到目标码率）
    const maxrateMultiplier = this.useSourceBitrate ? 2 : 1.5
    return {
      outputArgs: ['-b:v', b, '-maxrate', `${Math.round(num * maxrateMultiplier)}${suffix}`, '-bufsize', `${num * 2}${suffix}`],
    }
  }
}
