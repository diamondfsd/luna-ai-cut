import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { logMainInfo } from '../loggerService'

const LUT_SIZE = 33
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

type Rgb = [number, number, number]
type Hsl = [number, number, number]

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0))
}

function valueOf(color: Record<string, any>, key: string, fallback = 0): number {
  const value = color[key]
  return Number.isFinite(value) ? value : fallback
}

function luma(c: Rgb): number {
  return c[0] * LUMA_R + c[1] * LUMA_G + c[2] * LUMA_B
}

function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

function fract(v: number): number {
  return v - Math.floor(v)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function rgbToHsl(c: Rgb): Hsl {
  const r = clamp(c[0])
  const g = clamp(c[1])
  const b = clamp(c[2])
  const maxc = Math.max(r, g, b)
  const minc = Math.min(r, g, b)
  let h = 0
  let s = 0
  const light = (maxc + minc) * 0.5
  const d = maxc - minc
  if (d > 0.00001) {
    s = light > 0.5 ? d / (2 - maxc - minc) : d / (maxc + minc)
    if (maxc === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (maxc === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, light]
}

function hueToRgb(p: number, q: number, tValue: number): number {
  let t = tValue
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(hsl: Hsl): Rgb {
  const h = fract(hsl[0])
  const s = clamp(hsl[1])
  const light = clamp(hsl[2])
  if (s <= 0.00001) return [light, light, light]
  const q = light < 0.5 ? light * (1 + s) : light + s - light * s
  const p = 2 * light - q
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)]
}

function colorWheel(hue: number, amount: number): Rgb {
  const rgb = hslToRgb([fract(hue / 360), 0.55, 0.5])
  return [(rgb[0] - 0.5) * amount, (rgb[1] - 0.5) * amount, (rgb[2] - 0.5) * amount]
}

function addRgb(a: Rgb, b: Rgb, scale = 1): Rgb {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]
}

function evalCurvePoint(xValue: number, points: Array<{ x: number; y: number }> | undefined): number {
  if (!Array.isArray(points) || points.length === 0) return xValue
  const safe = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: clamp(point.x), y: clamp(point.y) }))
    .sort((a, b) => a.x - b.x)
    .slice(0, 12)
  if (safe.length === 0) return xValue

  let previous = { x: 0, y: 0 }
  for (const current of safe) {
    if (xValue <= current.x) {
      const t = (xValue - previous.x) / Math.max(current.x - previous.x, 0.0001)
      return mix(previous.y, current.y, t)
    }
    previous = current
  }
  const t = (xValue - previous.x) / Math.max(1 - previous.x, 0.0001)
  return mix(previous.y, 1, t)
}

function applyRgbCurve(c: Rgb, points: Array<{ x: number; y: number }> | undefined): Rgb {
  if (!Array.isArray(points) || points.length === 0) return c
  return [
    evalCurvePoint(clamp(c[0]), points),
    evalCurvePoint(clamp(c[1]), points),
    evalCurvePoint(clamp(c[2]), points),
  ]
}

function applyLuminanceCurve(c: Rgb, points: Array<{ x: number; y: number }> | undefined): Rgb {
  if (!Array.isArray(points) || points.length === 0) return c
  const y = clamp(luma(c))
  const shaped = evalCurvePoint(y, points)
  const ratio = y > 0.0001 ? shaped / y : 0
  return [c[0] * ratio, c[1] * ratio, c[2] * ratio]
}

function applyColorTransform(input: Rgb, color: Record<string, any>): Rgb {
  let c: Rgb = [...input]

  const exposure = clamp(valueOf(color, 'exposure'), -5, 5)
  c = [c[0] * Math.pow(2, exposure), c[1] * Math.pow(2, exposure), c[2] * Math.pow(2, exposure)]

  const brightness = clamp(valueOf(color, 'brightness'), -100, 100)
  if (brightness !== 0) {
    const gammaFactor = brightness / 100 * 4
    const gamma = gammaFactor >= 0 ? 1 / (1 + gammaFactor) : 1 - gammaFactor
    c = [Math.pow(Math.max(c[0], 0), gamma), Math.pow(Math.max(c[1], 0), gamma), Math.pow(Math.max(c[2], 0), gamma)]
  }

  const temperature = clamp(valueOf(color, 'temperature'), -100, 100) / 100
  const tint = clamp(valueOf(color, 'tint'), -100, 100) / 100
  c = [
    c[0] * (1 + temperature * 0.18 - tint * 0.04),
    c[1] * (1 + tint * 0.12),
    c[2] * (1 - temperature * 0.18 - tint * 0.04),
  ]

  let y = luma(c)
  const shadowMask = Math.pow(1 - y, 2)
  const highMask = Math.pow(y, 2)
  const shadows = clamp(valueOf(color, 'shadows'), -100, 100) / 100
  const highlights = clamp(valueOf(color, 'highlights'), -100, 100) / 100
  const blacks = clamp(valueOf(color, 'blacks'), -100, 100) / 100
  const whites = clamp(valueOf(color, 'whites'), -100, 100) / 100
  c = [
    c[0] + c[0] * shadows * shadowMask * 0.9 + c[0] * highlights * highMask * 0.9 + blacks * shadowMask * 0.35 + whites * highMask * 0.35,
    c[1] + c[1] * shadows * shadowMask * 0.9 + c[1] * highlights * highMask * 0.9 + blacks * shadowMask * 0.35 + whites * highMask * 0.35,
    c[2] + c[2] * shadows * shadowMask * 0.9 + c[2] * highlights * highMask * 0.9 + blacks * shadowMask * 0.35 + whites * highMask * 0.35,
  ]

  const black = clamp(valueOf(color, 'levelsBlack'), 0, 0.95)
  const white = Math.max(clamp(valueOf(color, 'levelsWhite', 1), 0.05, 1.5), black + 0.01)
  const gray = clamp(valueOf(color, 'levelsGray', 0.5), black + 0.01, white - 0.01)
  const gamma = Math.log(0.5) / Math.log((gray - black) / (white - black))
  c = [
    Math.pow(clamp((c[0] - black) / (white - black), 0, 4), gamma),
    Math.pow(clamp((c[1] - black) / (white - black), 0, 4), gamma),
    Math.pow(clamp((c[2] - black) / (white - black), 0, 4), gamma),
  ]

  y = luma(c)
  const sh = Math.pow(1 - y, 2)
  const hi = Math.pow(y, 2)
  const mid = clamp(1 - Math.abs(y - 0.5) * 2)
  c = addRgb(c, colorWheel(valueOf(color, 'gradeShadowsHue', 220), clamp(valueOf(color, 'gradeShadowsAmount'), -100, 100) / 100), sh)
  c = addRgb(c, colorWheel(valueOf(color, 'gradeMidHue', 35), clamp(valueOf(color, 'gradeMidAmount'), -100, 100) / 100), mid)
  c = addRgb(c, colorWheel(valueOf(color, 'gradeHighlightsHue', 42), clamp(valueOf(color, 'gradeHighlightsAmount'), -100, 100) / 100), hi)

  const contrast = clamp(valueOf(color, 'contrast'), -100, 100) / 100
  const pivot = 0.1845
  c = [(c[0] - pivot) * (1 + contrast * 1.35) + pivot, (c[1] - pivot) * (1 + contrast * 1.35) + pivot, (c[2] - pivot) * (1 + contrast * 1.35) + pivot]

  let grayValue = luma(c)
  const saturation = clamp(valueOf(color, 'saturation'), -100, 100) / 100
  c = mixRgb([grayValue, grayValue, grayValue], c, 1 + saturation)

  grayValue = luma(c)
  const maxc = Math.max(c[0], c[1], c[2])
  const minc = Math.min(c[0], c[1], c[2])
  const vibrance = clamp(valueOf(color, 'vibrance'), -100, 100) / 100
  c = mixRgb([grayValue, grayValue, grayValue], c, 1 + vibrance * (1 - clamp(maxc - minc)))

  const curve = color.curve?.points
  c = applyRgbCurve(c, curve?.rgb)
  c = applyLuminanceCurve(c, curve?.luminance)
  if (Array.isArray(curve?.red) && curve.red.length > 0) c[0] = evalCurvePoint(clamp(c[0]), curve.red)
  if (Array.isArray(curve?.green) && curve.green.length > 0) c[1] = evalCurvePoint(clamp(c[1]), curve.green)
  if (Array.isArray(curve?.blue) && curve.blue.length > 0) c[2] = evalCurvePoint(clamp(c[2]), curve.blue)

  const hslSat = clamp(valueOf(color, 'hslSat'), -100, 100) / 100
  const hslLum = clamp(valueOf(color, 'hslLum'), -100, 100) / 100
  const hueShift = clamp(valueOf(color, 'hue'), -180, 180)
  if (hslSat !== 0 || hslLum !== 0 || hueShift !== 0) {
    const hsl = rgbToHsl([clamp(c[0]), clamp(c[1]), clamp(c[2])])
    const targetHue = clamp(valueOf(color, 'hslHue', 30), 0, 360) / 360
    const distanceToTarget = Math.abs(fract(hsl[0] - targetHue + 0.5) - 0.5)
    const band = 1 - smoothstep(0.08, 0.28, distanceToTarget)
    hsl[0] = fract(hsl[0] + hueShift / 360)
    hsl[1] = clamp(hsl[1] + hslSat * band)
    hsl[2] = clamp(hsl[2] + hslLum * band)
    c = hslToRgb(hsl)
  }

  return [clamp(c[0]), clamp(c[1]), clamp(c[2])]
}

/**
 * 将 .cube 3D LUT 文件解析为 Float32Array。
 * 数据排布：N×N×N 的 RGB 值，按 B→G→R 顺序（WebGL TEXTURE_3D 格式）。
 * 总长度 = N^3 * 3
 */
export function parseCubeToFloatArray(cubePath: string): Float32Array {
  const content = readFileSync(cubePath, 'utf-8')
  let n = 0
  const values: number[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('TITLE')) continue
    if (trimmed.startsWith('DOMAIN')) continue

    const lutSize = trimmed.match(/^LUT_3D_SIZE\s+(\d+)/i)
    if (lutSize) {
      n = parseInt(lutSize[1], 10)
      continue
    }

    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length === 3) {
      const r = parseFloat(parts[0])
      const g = parseFloat(parts[1])
      const b = parseFloat(parts[2])
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        values.push(r, g, b)
      }
    }
  }

  if (n === 0 || values.length !== n * n * n * 3) {
    throw new Error(`LUT 解析失败: ${cubePath}, size=${n}, values=${values.length}, expected=${n * n * n * 3}`)
  }

  return new Float32Array(values)
}

function cubeValue(v: number): number {
  return Math.round(clamp(v) * 1_000_000) / 1_000_000
}

/**
 * 在内存中生成 3D LUT 数据，供 WebGL 预览直接上传纹理。
 * 数据排布与 .cube 文件一致：B → G → R，每个节点存 RGB。
 */
export function bakeColorLutData(colorParams: Record<string, any>): Float32Array {
  const N = LUT_SIZE
  const values = new Float32Array(N * N * N * 3)
  let offset = 0

  logMainInfo('[LUT] 开始生成内存调色 LUT', {
    lutSize: N,
    hasCurve: !!colorParams.curve?.points,
    hasGrading: colorParams.gradeShadowsAmount !== 0,
  })

  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const out = applyColorTransform([
          r / (N - 1),
          g / (N - 1),
          b / (N - 1),
        ], colorParams)
        values[offset++] = cubeValue(out[0])
        values[offset++] = cubeValue(out[1])
        values[offset++] = cubeValue(out[2])
      }
    }
  }

  logMainInfo('[LUT] 内存生成完成', { entryCount: N * N * N })
  return values
}

/**
 * 使用 ffmpeg 将颜色调色参数烘焙成 .cube 3D LUT 文件。
 *
 * 原理：
 * 1. 生成一个 33×33×33 的 RGB 网格图像（编码为 RAW）
 * 2. 把全部颜色参数通过 ffmpeg 滤镜处理这个网格图像
 * 3. 读出处理后的像素值，写成 .cube 格式
 *
 * .cube 文件大小：33^3 ≈ 36K 条目，约 500KB
 * 生成时间：通常 < 200ms
 */
export async function bakeColorLut(
  colorParams: Record<string, any>,
  outputCubePath: string,
): Promise<void> {
  const N = LUT_SIZE

  logMainInfo('[LUT] 开始生成调色参数 .cube', {
    outputCubePath,
    lutSize: N,
    hasCurve: !!colorParams.curve?.points,
    hasGrading: colorParams.gradeShadowsAmount !== 0,
  })

  const baseDir = path.dirname(outputCubePath)
  await fs.mkdir(baseDir, { recursive: true })

  const lutData = bakeColorLutData(colorParams)
  let lutContent = `TITLE "Luna AI Cut Generated LUT (${Date.now()})"\n`
  lutContent += `LUT_3D_SIZE ${N}\n`
  lutContent += `DOMAIN_MIN 0 0 0\n`
  lutContent += `DOMAIN_MAX 1 1 1\n\n`

  for (let i = 0; i < lutData.length; i += 3) {
    lutContent += `${lutData[i].toFixed(6)} ${lutData[i + 1].toFixed(6)} ${lutData[i + 2].toFixed(6)}\n`
  }

  await fs.writeFile(outputCubePath, lutContent)
  logMainInfo('[LUT] 生成完成', { outputCubePath, entryCount: N * N * N })
}
