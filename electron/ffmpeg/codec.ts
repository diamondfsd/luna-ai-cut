import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'

export interface CodecOptions {
  /** 硬件 h264 编码器名（如 h264_videotoolbox / h264_nvenc），不传则用 libx264 */
  encoderH264?: string
  /** 硬件 hevc 编码器名（如 hevc_videotoolbox / hevc_nvenc），不传则用 libx265 */
  encoderH265?: string
  /** 编码器额外参数（如 NVENC 的 preset / rc 等） */
  encoderArgs?: string[]
}

/**
 * Codec 模块 — 设置视频编码器、像素格式、音频编码
 * 支持硬件编码器注入（检测到硬件解码器后自动选用）
 */
export class CodecModule implements FfmpegModule {
  readonly name = 'codec'
  private opts: CodecOptions

  constructor(opts: CodecOptions = {}) {
    this.opts = opts
  }

  isActive(): boolean {
    return true
  }

  build(ctx: BuildContext): ModuleArgs {
    const { probe } = ctx
    const codec = probe.videoCodec
    const extraArgs = this.opts.encoderArgs ?? []

    // hevc / h265
    if (codec === 'hevc' || codec === 'h265') {
      const enc = this.opts.encoderH265 ?? 'libx265'
      // 硬件编码器没有 libx 前缀，不需要 tag，但 hvc1 tag 是容器级兼容
      const parts = enc.startsWith('libx')
        ? ['-tag:v', 'hvc1', '-c:v', enc]
        : ['-tag:v', 'hvc1', '-c:v', enc, ...extraArgs]

      return {
        outputArgs: [
          ...parts,
          '-pix_fmt', 'yuv420p',
          '-c:a', 'copy',
        ],
      }
    }

    // prores （不支持硬件加速）
    if (codec === 'prores') {
      return {
        outputArgs: [
          '-c:v', 'prores_ks',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'copy',
        ],
      }
    }

    // h264（默认）
    const enc = this.opts.encoderH264 ?? 'libx264'
    const parts = enc.startsWith('libx')
      ? ['-c:v', enc]
      : ['-c:v', enc, ...extraArgs]

    return {
      outputArgs: [
        ...parts,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
      ],
    }
  }
}
