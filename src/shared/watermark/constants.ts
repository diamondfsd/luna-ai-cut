import type { WatermarkSize } from '../types'

/** 水印宽度占内容宽度的比例 */
export const WATERMARK_SCALE: Record<WatermarkSize, number> = {
  small: 0.08,
  medium: 0.12,
  large: 0.18,
}

/** 水平边距占内容宽度的比例 */
export const WATERMARK_MARGIN_X_RATIO = 0.03

/** 垂直边距占内容高度的比例 */
export const WATERMARK_MARGIN_Y_RATIO = 0.03
