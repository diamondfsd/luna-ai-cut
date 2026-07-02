import { readFileSync } from 'node:fs'
import type { BuildContext, FfmpegModule, ModuleArgs } from './pipeline'
import { logMainInfo } from '../loggerService'
import { resolveWatermarkRatios } from '../../src/shared/watermark/layoutConfig'

function clamp(v: number, mn: number, mx: number): number {
  return Math.max(mn, Math.min(mx, v ?? 0))
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

function pngSize(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath)
  const pngSignature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Unsupported watermark image format: ${filePath}`)
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

/**
 * 将曲线点列表格式化为 ffmpeg curves filter 的参数字符串。
 */
function curvePointsToString(points: Array<{ x: number; y: number }> | undefined | null): string {
  if (!points || points.length === 0) return ''
  return points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => `${clamp(p.x, 0, 1).toFixed(3)}/${clamp(p.y, 0, 1).toFixed(3)}`)
    .join(' ')
}

/**
 * FullPipelineModule —— 将 EditPipeline 的完整参数编译为 ffmpeg filter_complex。
 *
 * 构建单个完整的 filter 字符串，避免多段 join 可能导致的拼接问题。
 *
 * LUT 模式（传入 lutPath 时）：
 *   颜色类参数烘焙为 .cube 3D LUT，用 lut3d 滤镜引用。
 *   空间/细节滤镜（unsharp/hqdn3d/watermark）仍走直接 filter。
 *
 * 直接模式（无 lutPath）：
 *   所有颜色参数映射为 ffmpeg filter 串。
 */
export class FullPipelineModule implements FfmpegModule {
  readonly name = 'fullPipeline'

  private pipeline: Record<string, any>
  private watermarkImagePath?: string
  private lutPath?: string

  constructor(
    pipeline: Record<string, any>,
    watermarkImagePath?: string,
    lutPath?: string,
  ) {
    this.pipeline = pipeline
    this.watermarkImagePath = watermarkImagePath
    this.lutPath = lutPath
  }

  isActive(): boolean {
    return true
  }

  build(ctx: BuildContext): ModuleArgs {
    const color = this.pipeline.color ?? {}
    const inputs: string[] = []
    const wmSettings = this.pipeline.watermark
    const hasWatermark = wmSettings?.enabled && this.watermarkImagePath
    const srcW = ctx.videoWidth
    const srcH = ctx.videoHeight

    // 主链：所有单输入滤镜用逗号串联
    const mainFilters: string[] = []

    // ── 1. Transform: direction / fine rotate / flip / crop ──
    // 方向旋转会改变画面方向和尺寸；细旋转只在当前画框中旋转，超出画框的部分裁掉。
    const orient = normalizeDegrees(this.pipeline.transform?.orientation ?? 0)
    const manualRotate = this.pipeline.transform?.rotate ?? 0
    let frameW = srcW
    let frameH = srcH
    let outputW = srcW
    let outputH = srcH

    if (orient !== 0) {
      const angle = (orient * Math.PI / 180).toFixed(6)
      mainFilters.push(`rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=black`)
      if (orient === 90 || orient === 270) {
        frameW = srcH
        frameH = srcW
      }
      outputW = frameW
      outputH = frameH
    }

    if (manualRotate !== 0) {
      const angle = (manualRotate * Math.PI / 180).toFixed(6)
      mainFilters.push(`rotate=${angle}:ow=iw:oh=ih:c=black`)
    }

    if (this.pipeline.transform?.flipV) {
      mainFilters.push('vflip')
    }
    if (this.pipeline.transform?.flipH) {
      mainFilters.push('hflip')
    }

    const crop = this.pipeline.transform?.crop
    if (crop && typeof crop.x === 'number' && crop.w > 0 && crop.h > 0) {
      const px = Math.round(crop.x * frameW)
      const py = Math.round(crop.y * frameH)
      const pw = Math.max(2, Math.round(crop.w * frameW))
      const ph = Math.max(2, Math.round(crop.h * frameH))
      const isFullFrame = px <= 0 && py <= 0 && pw >= frameW && ph >= frameH
      if (!isFullFrame) {
        mainFilters.push(`crop=${pw}:${ph}:${px}:${py}`)
        outputW = pw
        outputH = ph
      }
    }

    // ── 4. Color adjustments（LUT 模式 vs 直接模式） ──
    if (this.lutPath) {
      mainFilters.push(`lut3d=file='${this.lutPath}':interp=tetrahedral`)
    } else {
      const colorParts: string[] = []

      // exposure: colorlevels omax → c' = c * 2^exposure（匹配 GLSL）
      if (color.exposure != null && color.exposure !== 0) {
        const factor = Math.pow(2, clamp(color.exposure, -5, 5))
        colorParts.push(`colorlevels=rimin=0:gimin=0:bimin=0:rimax=1:gimax=1:bimax=1:romin=0:gomin=0:bomin=0:romax=${factor.toFixed(4)}:gomax=${factor.toFixed(4)}:bomax=${factor.toFixed(4)}`)
      }

      // eq: brightness / contrast / saturation
      const eqParts: string[] = []
      if (color.brightness != null && color.brightness !== 0) {
        eqParts.push(`brightness=${(clamp(color.brightness, -100, 100) / 100).toFixed(3)}`)
      }
      if (color.contrast != null && color.contrast !== 0) {
        eqParts.push(`contrast=${(1 + clamp(color.contrast, -100, 100) / 100).toFixed(3)}`)
      }
      if (color.saturation != null && color.saturation !== 0) {
        eqParts.push(`saturation=${(1 + clamp(color.saturation, -100, 100) / 100).toFixed(3)}`)
      }
      if (eqParts.length > 0) colorParts.push(`eq=${eqParts.join(':')}`)

      if (color.vibrance != null && color.vibrance !== 0) {
        colorParts.push(`vibrance=${(clamp(color.vibrance, -100, 100) / 100).toFixed(3)}`)
      }
      if (color.temperature != null && color.temperature !== 0) {
        colorParts.push(`colortemperature=${Math.round(5500 - clamp(color.temperature, -100, 100) * 30)}`)
      }

      // colorbalance + 颜色分级
      const cbParts: string[] = []
      if (color.shadows != null && color.shadows !== 0) {
        const v = clamp(clamp(color.shadows, -100, 100) / 100 * 1.2, -1, 1).toFixed(3)
        cbParts.push(`rs=${v}:gs=${v}:bs=${v}`)
      }
      if (color.highlights != null && color.highlights !== 0) {
        const v = clamp(clamp(color.highlights, -100, 100) / 100 * 1.2, -1, 1).toFixed(3)
        cbParts.push(`rh=${v}:gh=${v}:bh=${v}`)
      }
      if (color.tint != null && color.tint !== 0) {
        const v = clamp(clamp(color.tint, -100, 100) / 100 * -0.214, -1, 1).toFixed(3)
        cbParts.push(`gs=${v}:gm=${v}:gh=${v}`)
      }
      if (color.gradeShadowsAmount != null && color.gradeShadowsAmount !== 0) {
        const amount = clamp(color.gradeShadowsAmount, -100, 100) / 100 * 0.3
        const hue = (color.gradeShadowsHue ?? 220) / 360
        cbParts.push(`rs=${(amount * (1 - hue)).toFixed(3)}:gs=${(amount * (hue - 0.5)).toFixed(3)}:bs=${(amount * hue).toFixed(3)}`)
      }
      if (color.gradeMidAmount != null && color.gradeMidAmount !== 0) {
        const amount = clamp(color.gradeMidAmount, -100, 100) / 100 * 0.3
        const hue = (color.gradeMidHue ?? 35) / 360
        cbParts.push(`rm=${(amount * (1 - hue)).toFixed(3)}:gm=${(amount * (hue - 0.5)).toFixed(3)}:bm=${(amount * hue).toFixed(3)}`)
      }
      if (color.gradeHighlightsAmount != null && color.gradeHighlightsAmount !== 0) {
        const amount = clamp(color.gradeHighlightsAmount, -100, 100) / 100 * 0.3
        const hue = (color.gradeHighlightsHue ?? 42) / 360
        cbParts.push(`rh=${(amount * (1 - hue)).toFixed(3)}:gh=${(amount * (hue - 0.5)).toFixed(3)}:bh=${(amount * hue).toFixed(3)}`)
      }
      if (cbParts.length > 0) colorParts.push(`colorbalance=${cbParts.join(':')}`)

      // colorlevels
      const clParts: string[] = []
      if (color.levelsBlack != null && color.levelsBlack !== 0) {
        const v = clamp(color.levelsBlack, 0, 0.95).toFixed(3)
        clParts.push(`rimin=${v}:gimin=${v}:bimin=${v}`)
      }
      if (color.blacks != null && color.blacks !== 0) {
        let v = clamp(color.blacks, -100, 100) / 100 * -0.15
        v = clamp(v, -1, 1)
        clParts.push(`rimin=${v.toFixed(3)}:gimin=${v.toFixed(3)}:bimin=${v.toFixed(3)}`)
      }
      if (color.whites != null && color.whites !== 0) {
        let v = 1 + clamp(color.whites, -100, 100) / 100 * 0.15
        v = clamp(v, -1, 1)
        clParts.push(`rimax=${v.toFixed(3)}:gimax=${v.toFixed(3)}:bimax=${v.toFixed(3)}`)
      }
      if (color.levelsWhite != null && color.levelsWhite !== 1) {
        const v = clamp(color.levelsWhite, 0.05, 1.5).toFixed(3)
        clParts.push(`rimax=${v}:gimax=${v}:bimax=${v}`)
      }
      if (clParts.length > 0) colorParts.push(`colorlevels=${clParts.join(':')}`)

      // curves
      const curve = color.curve
      if (curve?.points) {
        const cpList: string[] = []
        const channels = [
          { key: 'rgb', ffKey: 'all' },
          { key: 'red', ffKey: 'red' },
          { key: 'green', ffKey: 'green' },
          { key: 'blue', ffKey: 'blue' },
        ] as const
        for (const { key, ffKey } of channels) {
          const pts = curve.points[key]
          const str = curvePointsToString(pts)
          if (str) cpList.push(`${ffKey}='${str}'`)
        }
        const lumPts = curve.points.luminance
        const lumStr = curvePointsToString(lumPts)
        if (lumStr && cpList.length === 0) cpList.push(`all='${lumStr}'`)
        if (cpList.length > 0) colorParts.push(`curves=${cpList.join(':')}`)
      }

      // HSL
      if (color.hslSat != null && color.hslSat !== 0) {
        const h = clamp(color.hslHue ?? 30, 0, 360) / 360
        const s = clamp(color.hslSat, -100, 100) / 100
        const l = clamp(color.hslLum ?? 0, -100, 100) / 100
        colorParts.push(`hsl=h=${(h * 360).toFixed(1)}:s=${s.toFixed(3)}:l=${l.toFixed(3)}`)
      }

      mainFilters.push(...colorParts)
    }

    // ── 5. Detail filters ──
    if (color.clarity != null && color.clarity !== 0) {
      mainFilters.push(`unsharp=luma_msize_x=9:luma_msize_y=9:luma_amount=${(clamp(color.clarity, -100, 100) / 100).toFixed(3)}`)
    }
    if (color.texture != null && color.texture !== 0) {
      mainFilters.push(`unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${(clamp(color.texture, -100, 100) / 100).toFixed(3)}`)
    }
    if (color.sharpen != null && color.sharpen !== 0) {
      mainFilters.push(`unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount=${(clamp(color.sharpen, 0, 100) / 100 * 2).toFixed(3)}`)
    }
    if (color.denoise != null && color.denoise !== 0) {
      const s = clamp(color.denoise, 0, 100) / 100 * 6
      mainFilters.push(`hqdn3d=${s.toFixed(2)}:${s.toFixed(2)}:${(s * 0.5).toFixed(2)}:${(s * 0.5).toFixed(2)}`)
    }

    // format（视频输出需要 yuv420p）
    mainFilters.push('format=yuv420p')

    // ── 构建完整的 filter_complex ──
    const filterParts: string[] = []

    // 主视频链
    if (mainFilters.length > 0) {
      filterParts.push(`${ctx.prevLabel}${mainFilters.join(',')}[vmain]`)
    }

    // 水印
    if (hasWatermark && this.watermarkImagePath) {
      inputs.push(this.watermarkImagePath)
      const position = wmSettings.position ?? 'bottom-center'
      const ratios = resolveWatermarkRatios(null, wmSettings.style, outputW, outputH, position)
      const rawWidthRatio = ratios?.widthRatio ?? wmSettings.widthPercent ?? 0.15
      const widthRatio = rawWidthRatio > 1 ? rawWidthRatio / 100 : rawWidthRatio
      const wmSize = pngSize(this.watermarkImagePath)
      const targetW = Math.min(Math.round(Math.max(outputW, outputH) * widthRatio), wmSize.width)
      const targetH = Math.round(targetW * wmSize.height / wmSize.width)
      const [vPos] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
      const xRatio = ratios?.xRatio ?? 0.03
      const yRatio = ratios?.yRatio ?? 0.03
      const xExpr = `W*${xRatio.toFixed(4)}`
      const yExpr = vPos === 'top' ? `H*${(1 - yRatio).toFixed(4)}`
        : `H-h-H*${yRatio.toFixed(4)}`

      filterParts.push(`[1:v]format=rgba,scale=${targetW}:${targetH}:flags=lanczos,setsar=1[wm]`)
      filterParts.push(`[vmain][wm]overlay=${xExpr}:${yExpr}:format=auto[vout]`)
    } else {
      // 无水印，直接输出
      filterParts.push(`[vmain]null[vout]`)
    }

    // 调试：逐元素打印，定位 join 异常
    for (let i = 0; i < filterParts.length; i++) {
      const el = filterParts[i]
      logMainInfo(`[FullPipelineModule] filterParts[${i}]`, {
        len: el.length,
        first50: el.substring(0, 50),
        last50: el.substring(Math.max(0, el.length - 50)),
        full: el,
      })
    }

    // 手动构建 filter
    let resultFilter: string
    if (filterParts.length === 1) {
      resultFilter = filterParts[0]
    } else if (filterParts.length === 2) {
      resultFilter = filterParts[0] + ';' + filterParts[1]
    } else if (filterParts.length === 3) {
      resultFilter = filterParts[0] + ';' + filterParts[1] + ';' + filterParts[2]
    } else {
      resultFilter = filterParts.join(';')
    }

    // 验证 filter 拼接正确性
    logMainInfo('[FullPipelineModule] resultFilter', {
      len: resultFilter.length,
      first50: resultFilter.substring(0, 50),
      last50: resultFilter.substring(Math.max(0, resultFilter.length - 50)),
      idxVmain: resultFilter.indexOf('[vmain]'),
      idxSemicolon: resultFilter.indexOf(';'),
      hasScale: resultFilter.includes('[1:v]scale='),
      hasVout: resultFilter.endsWith('[vout]'),
    })

    return {
      inputs: inputs.length > 0 ? inputs : undefined,
      filters: [resultFilter],
      outputLabel: 'vout',
    }
  }
}
