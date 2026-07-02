// 水印布局配置索引（自动生成）
// 按设备拆分，方便维护

import { WATERMARK_LAYOUT as _go_ultra_layout } from './go-ultra'
import { WATERMARK_LAYOUT as _luna_ultra_layout } from './luna-ultra'

export { WATERMARK_LAYOUT as go_ultra_layout } from './go-ultra'
export { WATERMARK_LAYOUT as luna_ultra_layout } from './luna-ultra'

export const DEVICE_TO_TABLE_NAME: Record<string, string> = {
  'luna-ultra': 'Luna Ultra',
  'go-ultra': 'Go Ultra',
}

export const STYLE_TO_THEME: Record<string, string> = {
  'luna_ultra': 'Leica',
  'luna_ultra_cn': 'Leica-CN',
  'go_ultra': 'Normal',
  'go_ultra_cn': 'Normal-CN',
}

export const POSITION_TO_KEY: Record<string, string> = {
  'bottom-center': 'BottomCenter',
  'bottom-left': 'BottomLeft',
  'bottom-right': 'BottomRight',
  'top-left': 'TopLeft',
  'top-right': 'TopRight',
  'top-center': 'BottomCenter', // fallback: use center x, compute top y
}

/** 表中所有支持的宽高比（用于 fallback 查找） */
const TABLE_ASPECT_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16',
  '3:1', '1:3', '27:10', '10:27', '4:1',
  '235:100', '100:235', '47:20', '20:47',
]

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** 根据图片宽高计算宽高比字符串（如 "16:9"） */
export function getAspectRatioKey(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '16:9'
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

/** 找到最接近的表中宽高比 */
export function closestAspectRatio(w: number, h: number): string {
  const actual = w / h
  let best = '16:9'
  let bestDiff = Infinity
  for (const ratio of TABLE_ASPECT_RATIOS) {
    const [n, d] = ratio.split(':').map(Number)
    const diff = Math.abs(actual - n / d)
    if (diff < bestDiff) {
      bestDiff = diff
      best = ratio
    }
  }
  return best
}

/** 从生成的数据中查找水印布局比率 */
function lookupFromData(
  deviceName: string,
  themeName: string,
  aspectRatio: string,
  positionKey: string,
): [number, number, number] | null {
  const dataMap = deviceName === 'Go Ultra' ? _go_ultra_layout : (deviceName === 'Luna Ultra' ? _luna_ultra_layout : null)
  if (!dataMap) return null
  const key = `${themeName}|${aspectRatio}|${positionKey}`
  return dataMap[key] ?? null
}

/** 根据设备名、主题、宽高比和位置查找水印布局比率 */
export function lookupWatermarkLayout(
  deviceName: string,
  themeName: string,
  aspectRatio: string,
  position: string,
): [widthRatio: number, xRatio: number, yRatio: number] | null {
  return lookupFromData(deviceName, themeName, aspectRatio, position)
}

/** 根据设备 ID 和样式值解析布局比率（含 fallback） */
export function resolveWatermarkRatios(
  deviceId: string | null | undefined,
  styleValue: string,
  contentW: number,
  contentH: number,
  positionKey: string,
): { widthRatio: number; xRatio: number; yRatio: number } | null {
  // 从样式值反推设备名（如 'luna_ultra' → 'Luna Ultra'）
  let tableName = deviceId ? DEVICE_TO_TABLE_NAME[deviceId] : null
  if (!tableName) {
    // 尝试从 styleValue 推导：'luna_ultra' → 包含 'luna' → Luna Ultra
    if (styleValue.startsWith('luna_')) tableName = 'Luna Ultra'
    else if (styleValue.startsWith('go_')) tableName = 'Go Ultra'
  }
  const themeName = STYLE_TO_THEME[styleValue]
  if (!tableName || !themeName) return null

  const aspect = closestAspectRatio(contentW, contentH)
  const pos = POSITION_TO_KEY[positionKey]
  if (!pos) return null

  const result = lookupFromData(tableName, themeName, aspect, pos)
  if (result) return { widthRatio: result[0], xRatio: result[1], yRatio: result[2] }

  // 尝试 exact aspect ratio
  const exactAspect = getAspectRatioKey(contentW, contentH)
  if (exactAspect !== aspect) {
    const exactResult = lookupFromData(tableName, themeName, exactAspect, pos)
    if (exactResult) return { widthRatio: exactResult[0], xRatio: exactResult[1], yRatio: exactResult[2] }
  }

  return null
}
