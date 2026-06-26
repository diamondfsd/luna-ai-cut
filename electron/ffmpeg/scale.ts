import type { FfmpegModule, BuildContext, ModuleArgs } from './pipeline'

/** 分辨率预设映射 — 值为目标短边像素 */
const RESOLUTION_MAP: Record<string, number> = {
  '1080p': 1080,
  '2k': 1440,
  '4k': 2160,
}

/** 自适应朝向缩放 filter */
function orientationAwareScale(targetShortEdge: number): string {
  return `scale='if(gte(iw,ih),-2,${targetShortEdge})':'if(gte(iw,ih),${targetShortEdge},-2)'`
}

export interface ScaleOptions {
  resolution: string
}

/**
 * 缩放模块 — 根据分辨率预设缩放视频，自动适配横屏/竖屏
 */
export class ScaleModule implements FfmpegModule {
  readonly name = 'scale'
  private targetShortEdge: number | null = null

  constructor(opts: ScaleOptions) {
    this.targetShortEdge = RESOLUTION_MAP[opts.resolution] ?? null
  }

  isActive(): boolean {
    return this.targetShortEdge !== null
  }

  build(ctx: BuildContext): ModuleArgs {
    const label = '[scaled]'
    const target = this.targetShortEdge!
    const isLandscape = ctx.videoWidth >= ctx.videoHeight
    // 计算输出分辨率并更新上下文，供下游模块（如水印）使用
    if (isLandscape) {
      const ratio = ctx.videoWidth / ctx.videoHeight
      ctx.outputWidth = Math.round(target * ratio)
      ctx.outputHeight = target
    } else {
      const ratio = ctx.videoHeight / ctx.videoWidth
      ctx.outputWidth = target
      ctx.outputHeight = Math.round(target * ratio)
    }
    return {
      filters: [`${ctx.prevLabel}${orientationAwareScale(target)}${label}`],
      outputLabel: label,
    }
  }
}
