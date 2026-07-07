/**
 * .cube LUT 文件解析器 + JS 端像素采样（三线性插值）
 *
 * 用于滤镜缩略图渲染。
 */
export class LutCubeData {
  readonly size: number
  /** 展平的 LUT 数据 [r0g0b0_R, r0g0b0_G, r0g0b0_B, r0g0b1_R, ...] */
  readonly data: Float32Array

  constructor(size: number, data: Float32Array) {
    this.size = size
    this.data = data
  }

  /** 三线性插值采样 */
  sample(r: number, g: number, b: number): [number, number, number] {
    const n = this.size
    const maxIdx = n - 1

    // 映射到网格坐标
    const x = r * maxIdx
    const y = g * maxIdx
    const z = b * maxIdx

    const ix = Math.min(Math.floor(x), maxIdx - 1)
    const iy = Math.min(Math.floor(y), maxIdx - 1)
    const iz = Math.min(Math.floor(z), maxIdx - 1)
    const fx = x - ix
    const fy = y - iy
    const fz = z - iz
    const ix1 = ix + 1
    const iy1 = iy + 1
    const iz1 = iz + 1

    const get = (ri: number, gi: number, bi: number): [number, number, number] => {
      const idx = (ri * n * n + gi * n + bi) * 3
      return [this.data[idx + 2], this.data[idx + 1], this.data[idx]]
      // .cube 文件是 BGR 格式: idx=B, idx+1=G, idx+2=R
    }

    // 8 个角
    const c000 = get(ix, iy, iz)
    const c100 = get(ix1, iy, iz)
    const c010 = get(ix, iy1, iz)
    const c110 = get(ix1, iy1, iz)
    const c001 = get(ix, iy, iz1)
    const c101 = get(ix1, iy, iz1)
    const c011 = get(ix, iy1, iz1)
    const c111 = get(ix1, iy1, iz1)

    // x 轴插值
    const lerpX = (a: [number,number,number], b: [number,number,number]) =>
      [a[0] + (b[0] - a[0]) * fx, a[1] + (b[1] - a[1]) * fx, a[2] + (b[2] - a[2]) * fx] as [number,number,number]
    const c00 = lerpX(c000, c100)
    const c10 = lerpX(c010, c110)
    const c01 = lerpX(c001, c101)
    const c11 = lerpX(c011, c111)

    // y 轴插值
    const lerpY = (a: [number,number,number], b: [number,number,number]) =>
      [a[0] + (b[0] - a[0]) * fy, a[1] + (b[1] - a[1]) * fy, a[2] + (b[2] - a[2]) * fy] as [number,number,number]
    const c0 = lerpY(c00, c10)
    const c1 = lerpY(c01, c11)

    // z 轴插值
    return [
      c0[0] + (c1[0] - c0[0]) * fz,
      c0[1] + (c1[1] - c0[1]) * fz,
      c0[2] + (c1[2] - c0[2]) * fz,
    ]
  }
}

const parserCache = new Map<string, LutCubeData>()

/** 获取或加载 .cube 文件，返回 LutCubeData */
export async function getLutCubeData(cubeUrl: string): Promise<LutCubeData> {
  const cached = parserCache.get(cubeUrl)
  if (cached) return cached

  const res = await fetch(cubeUrl)
  if (!res.ok) throw new Error(`加载 LUT 失败: ${res.status}`)
  const text = await res.text()

  let size = 0
  const values: number[] = []

  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('DOMAIN')) continue

    const sizeMatch = line.match(/LUT_3D_SIZE\s+(\d+)/)
    if (sizeMatch) { size = parseInt(sizeMatch[1]); continue }
    if (line.startsWith('LUT_1D_SIZE')) continue

    const parts = line.split(/\s+/)
    if (parts.length >= 3) {
      const r = parseFloat(parts[0])
      const g = parseFloat(parts[1])
      const b = parseFloat(parts[2])
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        values.push(r, g, b)
      }
    }
  }

  if (size === 0) throw new Error('未找到 LUT_3D_SIZE')
  const expected = size * size * size * 3
  if (values.length !== expected) {
    // 有些文件末尾有空行或多余内容，截断处理
    if (values.length > expected) values.length = expected
    if (values.length < expected) throw new Error(`数据不完整: 期望 ${expected} 个值, 实际 ${values.length}`)
  }

  const lut = new LutCubeData(size, new Float32Array(values))
  parserCache.set(cubeUrl, lut)
  return lut
}

/** 将 LutCubeData 应用到 ImageData，返回 data URL */
export function applyLutToImageData(
  source: ImageData,
  lut: LutCubeData,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')!
  const output = ctx.createImageData(source)
  const d = source.data
  const od = output.data

  for (let i = 0; i < d.length; i += 4) {
    const [ro, go, bo] = lut.sample(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
    od[i] = Math.round(Math.min(1, Math.max(0, ro)) * 255)
    od[i + 1] = Math.round(Math.min(1, Math.max(0, go)) * 255)
    od[i + 2] = Math.round(Math.min(1, Math.max(0, bo)) * 255)
    od[i + 3] = d[i + 3]
  }

  ctx.putImageData(output, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}
