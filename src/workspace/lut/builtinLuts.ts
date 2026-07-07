/**
 * 内置滤镜 LUT 生成器
 *
 * 每个内置滤镜定义为一个 .cube 文件内容生成函数。
 * 使用 17 级 3D LUT（4913 个采样点），平衡精度与性能。
 */

export interface BuiltinLutDef {
  id: string
  name: string
  /** 生成 .cube 文件文本内容的函数 */
  generate: () => string
}

const LUT_SIZE = 17

/** 生成一个 .cube 文件字符串 */
function generateCube(
  title: string,
  transform: (r: number, g: number, b: number) => [number, number, number],
): string {
  const size = LUT_SIZE
  const step = 1 / (size - 1)
  const lines: string[] = []
  lines.push(`TITLE "${title}"`)
  lines.push(`LUT_3D_SIZE ${size}`)
  lines.push(`DOMAIN_MIN 0.0 0.0 0.0`)
  lines.push(`DOMAIN_MAX 1.0 1.0 1.0`)
  lines.push('')
  for (let ri = 0; ri < size; ri++) {
    for (let gi = 0; gi < size; gi++) {
      for (let bi = 0; bi < size; bi++) {
        const r = ri * step
        const g = gi * step
        const b = bi * step
        const [ro, go, bo] = transform(r, g, b)
        lines.push(`${ro.toFixed(6)} ${go.toFixed(6)} ${bo.toFixed(6)}`)
      }
    }
  }
  return lines.join('\n')
}

// ── 内置滤镜 ──

/**
 * 日系清新：
 * 整体偏亮、轻微冷调、低对比柔和
 */
export const LUT_JAPANESE_FRESH: BuiltinLutDef = {
  id: 'japanese-fresh',
  name: '日系清新',
  generate: () => generateCube('Japanese Fresh', (r, g, b) => {
    const brightness = 0.04
    const contrast = 1.02
    const warmth = -0.03
    return [
      Math.min(1, Math.max(0, (r - 0.5) * contrast + 0.5 + brightness + warmth * 0.5)),
      Math.min(1, Math.max(0, (g - 0.5) * contrast + 0.5 + brightness)),
      Math.min(1, Math.max(0, (b - 0.5) * contrast + 0.5 + brightness - warmth * 0.7)),
    ]
  }),
}

/**
 * 胶片复古：
 * 褪色效果、暖调、暗部提亮
 */
export const LUT_VINTAGE: BuiltinLutDef = {
  id: 'vintage',
  name: '胶片复古',
  generate: () => generateCube('Vintage', (r, g, b) => {
    const fade = 0.06
    const warmth = 0.05
    const shadowLift = 0.04
    const desat = 0.08
    const gray = (r + g + b) / 3
    r = r * (1 - desat) + gray * desat
    g = g * (1 - desat) + gray * desat
    b = b * (1 - desat) + gray * desat
    r = Math.min(1, r + fade + warmth)
    g = Math.min(1, g + fade + warmth * 0.3)
    b = Math.max(0, b + fade - warmth * 0.2)
    // Shadow lift
    r = r + (1 - r) * shadowLift * Math.max(0, 1 - r * 2)
    g = g + (1 - g) * shadowLift * Math.max(0, 1 - g * 2)
    b = b + (1 - b) * shadowLift * Math.max(0, 1 - b * 2)
    return [
      Math.min(1, Math.max(0, r)),
      Math.min(1, Math.max(0, g)),
      Math.min(1, Math.max(0, b)),
    ]
  }),
}

/**
 * 黑白经典：
 * 高对比黑白，保留红色通道权重
 */
export const LUT_BLACK_WHITE: BuiltinLutDef = {
  id: 'black-white',
  name: '黑白经典',
  generate: () => generateCube('Black White', (r, g, b) => {
    // Rec.709 luminance weights
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
    const contrast = 1.15
    const result = Math.min(1, Math.max(0, (lum - 0.5) * contrast + 0.5))
    return [result, result, result]
  }),
}

/**
 * 高饱和运动：
 * 高对比、高饱和、冷色偏蓝
 */
export const LUT_SPORT: BuiltinLutDef = {
  id: 'sport',
  name: '高饱和运动',
  generate: () => generateCube('Sport', (r, g, b) => {
    const contrast = 1.12
    const saturate = 1.25
    const blueShift = 0.03
    const gray = (r + g + b) / 3
    r = (r - gray) * saturate + gray
    g = (g - gray) * saturate + gray
    b = (b - gray) * saturate + gray
    r = (r - 0.5) * contrast + 0.5
    g = (g - 0.5) * contrast + 0.5
    b = (b - 0.5) * contrast + 0.5 + blueShift
    return [
      Math.min(1, Math.max(0, r)),
      Math.min(1, Math.max(0, g)),
      Math.min(1, Math.max(0, b)),
    ]
  }),
}

/**
 * 冷调电影：
 * 青蓝调、电影感、暗部压低
 */
export const LUT_COOL_CINEMA: BuiltinLutDef = {
  id: 'cool-cinema',
  name: '冷调电影',
  generate: () => generateCube('Cool Cinema', (r, g, b) => {
    const contrast = 1.08
    const teal = 0.08
    const crush = 0.03
    r = (r - 0.5) * contrast + 0.5 - teal * 0.6
    g = (g - 0.5) * contrast + 0.5 - teal * 0.3
    b = (b - 0.5) * contrast + 0.5 + teal * 0.4
    // Crush shadows slightly
    const shadowAmount = Math.max(0, 1 - r * 2)
    r = r - crush * shadowAmount
    g = g - crush * shadowAmount * 0.7
    return [
      Math.min(1, Math.max(0, r)),
      Math.min(1, Math.max(0, g)),
      Math.min(1, Math.max(0, b)),
    ]
  }),
}

/**
 * 奶油人像：
 * 肤色提亮柔和、轻微暖调、暗部淡化
 */
export const LUT_PORTRAIT: BuiltinLutDef = {
  id: 'portrait',
  name: '奶油人像',
  generate: () => generateCube('Portrait', (r, g, b) => {
    const warmth = 0.03
    const softenShadows = 0.04
    const brightenMid = 0.03
    r = r + warmth
    g = g + warmth * 0.4
    b = b - warmth * 0.2
    r = r + brightenMid * (1 - Math.abs(r - 0.5) * 2)
    g = g + brightenMid * (1 - Math.abs(g - 0.5) * 2) * 0.7
    b = b + brightenMid * (1 - Math.abs(b - 0.5) * 2) * 0.5
    r = r + (1 - r) * softenShadows * Math.max(0, 1 - r * 2)
    g = g + (1 - g) * softenShadows * Math.max(0, 1 - g * 2) * 0.8
    b = b + (1 - b) * softenShadows * Math.max(0, 1 - b * 2) * 0.6
    return [
      Math.min(1, Math.max(0, r)),
      Math.min(1, Math.max(0, g)),
      Math.min(1, Math.max(0, b)),
    ]
  }),
}

/** 所有内置滤镜列表 */
export const BUILTIN_LUTS: BuiltinLutDef[] = [
  LUT_JAPANESE_FRESH,
  LUT_VINTAGE,
  LUT_BLACK_WHITE,
  LUT_SPORT,
  LUT_COOL_CINEMA,
  LUT_PORTRAIT,
]

/** 根据 ID 查找内置滤镜 */
export function findBuiltinLut(id: string): BuiltinLutDef | undefined {
  return BUILTIN_LUTS.find((lut) => lut.id === id)
}

/** 将 .cube 文本内容编码为 Uint8Array */
export function cubeTextToBuffer(cubeText: string): Uint8Array {
  return new TextEncoder().encode(cubeText)
}
