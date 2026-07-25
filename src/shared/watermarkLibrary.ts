import type { CustomWatermarkAsset } from './types'

export function addCustomWatermarkAsset(
  assets: CustomWatermarkAsset[],
  asset: CustomWatermarkAsset,
): CustomWatermarkAsset[] {
  return [asset, ...assets.filter((item) => item.id !== asset.id)]
}

export function removeCustomWatermarkAsset(
  assets: CustomWatermarkAsset[],
  assetId: string,
): CustomWatermarkAsset[] {
  return assets.filter((item) => item.id !== assetId)
}
