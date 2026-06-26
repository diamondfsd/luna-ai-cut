import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'

/**
 * Codec 模块 — 设置视频编码器、像素格式、音频编码
 * 始终处于激活状态（视频导出必须指定编码器）
 */
export class CodecModule implements FfmpegModule {
  readonly name = 'codec'

  isActive(): boolean {
    return true
  }

  build(ctx: BuildContext): ModuleArgs {
    const { probe } = ctx
    const codec = probe.videoCodec

    // libx265 默认输出 hev1 标签，QuickTime Player 只认 hvc1
    let videoCodec: string
    if (codec === 'hevc' || codec === 'h265') {
      videoCodec = '-tag:v hvc1 -c:v libx265'
    } else if (codec === 'prores') {
      videoCodec = '-c:v prores_ks'
    } else {
      videoCodec = '-c:v libx264'
    }

    const parts = videoCodec.split(' ')
    return {
      outputArgs: [
        ...parts,
        '-pix_fmt', 'yuv420p',   // QuickTime Player 不支援 yuv444p
        '-c:a', 'aac', '-b:a', '192k',
      ],
    }
  }
}
