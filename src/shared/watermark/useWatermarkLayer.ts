/**
 * useWatermarkLayer — 水印层构建器（暂不计算位置，仅打印映射表参数）
 *
 * 输入：WatermarkSettings + sourceDeviceId
 * 输出：null（水印位置由 Native Core 后端计算）
 */
import { useEffect, useState } from 'react'
import type { WatermarkSettings } from '../types'
import { resolveWatermarkRatios } from './layoutConfig'

export interface WatermarkStaticLayer {
  imagePath: string
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX: number; srcY: number; srcW: number; srcH: number
  opacity: number; zIndex: number
}

interface UseWatermarkLayerOptions {
  settings: WatermarkSettings
  sourceDeviceId?: string | null
  watermarkImagePath?: string | null
  contentW?: number
  contentH?: number
}

export function useWatermarkLayer(opts: UseWatermarkLayerOptions) {
  const { settings, sourceDeviceId, contentW = 1920, contentH = 1080 } = opts
  const [layers, setLayers] = useState<WatermarkStaticLayer[] | null>(null)

  useEffect(() => {
    if (!settings.enabled) { setLayers(null); return }

    const ratios = resolveWatermarkRatios(
      sourceDeviceId ?? null, settings.style,
      contentW, contentH, settings.position,
    )
    console.log('[useWatermarkLayer] 映射表参数:', {
      sourceDeviceId,
      style: settings.style,
      position: settings.position,
      contentW,
      contentH,
      ratios,
    })
    // 位置计算已移除，由 Native Core 后端完成
    setLayers(null)
  }, [settings.enabled, settings.style, settings.position, sourceDeviceId, contentW, contentH])

  return layers
}
