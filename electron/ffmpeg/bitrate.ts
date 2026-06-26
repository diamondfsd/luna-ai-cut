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
}

/**
 * 码率模块 — 设置视频码率（预设或自定义）
 */
export class BitrateModule implements FfmpegModule {
  readonly name = 'bitrate'
  private bitrate: string | null

  constructor(opts: BitrateOptions) {
    if (opts.quality === 'original') {
      this.bitrate = null
    } else if (opts.quality === 'custom' && opts.customBitrate) {
      this.bitrate = `${opts.customBitrate}k`
    } else {
      this.bitrate = QUALITY_BITRATES[opts.quality] ?? null
    }
  }

  isActive(): boolean {
    return this.bitrate !== null
  }

  build(_ctx: BuildContext): ModuleArgs {
    const b = this.bitrate!
    const match = b.match(/^(\d+)([kKM]?)$/)
    const num = match ? parseInt(match[1]) : 0
    const suffix = match?.[2] ?? ''
    return {
      outputArgs: ['-b:v', b, '-maxrate', b, '-bufsize', `${num * 2}${suffix}`],
    }
  }
}
