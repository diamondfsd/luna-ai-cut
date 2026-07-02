import type { ToneCurveAdjust } from './editPipeline'

/**
 * 将曲线调整数据导出为点列表（x, y 对），供 ffmpeg curves filter 使用。
 * 返回值格式: "0/0 0.25/0.5 0.5/0.7 1/1"
 */
export function toneCurveToPointList(points: Array<{ x: number; y: number }>): string {
  if (!points || points.length === 0) return ''
  return points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => {
      const x = Math.max(0, Math.min(1, p.x))
      const y = Math.max(0, Math.min(1, p.y))
      return `${x.toFixed(3)}/${y.toFixed(3)}`
    })
    .join(' ')
}

/**
 * 将完整 curve（5 通道）编译为 ffmpeg curves filter 参数。
 * 如果没有任何曲线点，返回空字符串。
 */
export function compileCurvesFilter(curve: ToneCurveAdjust): string {
  const parts: string[] = []

  const channels = [
    { key: 'rgb', filterKey: 'all' },
    { key: 'red', filterKey: 'red' },
    { key: 'green', filterKey: 'green' },
    { key: 'blue', filterKey: 'blue' },
  ] as const

  for (const { key, filterKey } of channels) {
    const points = curve.points[key]
    const list = toneCurveToPointList(points ?? [])
    if (list) {
      parts.push(`${filterKey}='${list}'`)
    }
  }

  // ffmpeg curves filter 不支持独立的 luminance 通道，可以近似用 rgb 混合
  const lumPoints = curve.points.luminance
  const lumList = toneCurveToPointList(lumPoints ?? [])
  if (lumList && parts.length === 0) {
    // 只有亮度曲线，映射到 all 通道
    parts.push(`all='${lumList}'`)
  }

  return parts.length > 0 ? `curves=${parts.join(':')}` : ''
}
