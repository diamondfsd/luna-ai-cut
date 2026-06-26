import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'

export interface FrameRateOptions {
  frameRate: string
}

/**
 * 帧率模块 — 设置输出视频帧率
 */
export class FrameRateModule implements FfmpegModule {
  readonly name = 'framerate'
  private fps: string | null

  constructor(opts: FrameRateOptions) {
    this.fps = opts.frameRate === 'original' ? null : opts.frameRate
  }

  isActive(): boolean {
    return this.fps !== null
  }

  build(_ctx: BuildContext): ModuleArgs {
    return { outputArgs: ['-r', this.fps!] }
  }
}
