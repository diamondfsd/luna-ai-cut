/**
 * 内置滤镜 LUT 生成器
 *
 * 每个内置滤镜定义为一个 .cube 文件内容生成函数。
 * 使用 17 级 3D LUT（4913 个采样点），平衡精度与性能。
 * 同时导出 transformFn 用于 JS 侧 Canvas 缩略图生成。
 */

export interface BuiltinLutDef {
  id: string
  name: string
  /** 生成 .cube 文件文本内容的函数 */
  generate: () => string
  /** JS 侧的像素变换函数（用于缩略图预览等，与 generate 一致的变换逻辑） */
  transformFn: (r: number, g: number, b: number) => [number, number, number]
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

// ── 变换函数 ──

function japaneseFresh(r: number, g: number, b: number): [number, number, number] {
  const brightness = 0.04
  const contrast = 1.02
  const warmth = -0.03
  return [
    Math.min(1, Math.max(0, (r - 0.5) * contrast + 0.5 + brightness + warmth * 0.5)),
    Math.min(1, Math.max(0, (g - 0.5) * contrast + 0.5 + brightness)),
    Math.min(1, Math.max(0, (b - 0.5) * contrast + 0.5 + brightness - warmth * 0.7)),
  ]
}

function vintage(r: number, g: number, b: number): [number, number, number] {
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
  const sr = Math.max(0, 1 - r * 2)
  r = r + (1 - r) * shadowLift * sr
  g = g + (1 - g) * shadowLift * sr * 0.6
  b = b + (1 - b) * shadowLift * sr * 0.4
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))]
}

function blackWhite(r: number, g: number, b: number): [number, number, number] {
  const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
  const contrast = 1.15
  const result = Math.min(1, Math.max(0, (lum - 0.5) * contrast + 0.5))
  return [result, result, result]
}

function sport(r: number, g: number, b: number): [number, number, number] {
  const contrast = 1.12
  const saturateVal = 1.25
  const blueShift = 0.03
  const gray = (r + g + b) / 3
  r = (r - gray) * saturateVal + gray
  g = (g - gray) * saturateVal + gray
  b = (b - gray) * saturateVal + gray
  r = (r - 0.5) * contrast + 0.5
  g = (g - 0.5) * contrast + 0.5
  b = (b - 0.5) * contrast + 0.5 + blueShift
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))]
}

function coolCinema(r: number, g: number, b: number): [number, number, number] {
  const contrast = 1.08
  const teal = 0.08
  const crush = 0.03
  r = (r - 0.5) * contrast + 0.5 - teal * 0.6
  g = (g - 0.5) * contrast + 0.5 - teal * 0.3
  b = (b - 0.5) * contrast + 0.5 + teal * 0.4
  const shadowAmount = Math.max(0, 1 - r * 2)
  r = r - crush * shadowAmount
  g = g - crush * shadowAmount * 0.7
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))]
}

function portrait(r: number, g: number, b: number): [number, number, number] {
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
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))]
}

// ── 内置滤镜定义 ──

export const LUT_JAPANESE_FRESH: BuiltinLutDef = {
  id: 'japanese-fresh',
  name: '日系清新',
  transformFn: japaneseFresh,
  generate: () => generateCube('Japanese Fresh', japaneseFresh),
}

export const LUT_VINTAGE: BuiltinLutDef = {
  id: 'vintage',
  name: '胶片复古',
  transformFn: vintage,
  generate: () => generateCube('Vintage', vintage),
}

export const LUT_BLACK_WHITE: BuiltinLutDef = {
  id: 'black-white',
  name: '黑白经典',
  transformFn: blackWhite,
  generate: () => generateCube('Black White', blackWhite),
}

export const LUT_SPORT: BuiltinLutDef = {
  id: 'sport',
  name: '高饱和运动',
  transformFn: sport,
  generate: () => generateCube('Sport', sport),
}

export const LUT_COOL_CINEMA: BuiltinLutDef = {
  id: 'cool-cinema',
  name: '冷调电影',
  transformFn: coolCinema,
  generate: () => generateCube('Cool Cinema', coolCinema),
}

export const LUT_PORTRAIT: BuiltinLutDef = {
  id: 'portrait',
  name: '奶油人像',
  transformFn: portrait,
  generate: () => generateCube('Portrait', portrait),
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

/** 将滤镜变换函数应用于 ImageData，返回 data URL */
export function applyTransformToImageData(
  imageData: ImageData,
  transformFn: (r: number, g: number, b: number) => [number, number, number],
): string {
  const outCanvas = document.createElement('canvas')
  outCanvas.width = imageData.width
  outCanvas.height = imageData.height
  const ctx = outCanvas.getContext('2d')!
  const output = ctx.createImageData(imageData)
  const d = imageData.data
  const od = output.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const [ro, go, bo] = transformFn(r, g, b)
    od[i] = Math.round(Math.min(1, Math.max(0, ro)) * 255)
    od[i + 1] = Math.round(Math.min(1, Math.max(0, go)) * 255)
    od[i + 2] = Math.round(Math.min(1, Math.max(0, bo)) * 255)
    od[i + 3] = d[i + 3]
  }
  ctx.putImageData(output, 0, 0)
  return outCanvas.toDataURL('image/jpeg', 0.85)
}
