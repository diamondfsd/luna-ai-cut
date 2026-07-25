import type { CustomWatermarkAsset } from './types'

export function addCustomWatermarkAsset(
  assets: CustomWatermarkAsset[],
  asset: CustomWatermarkAsset,
): CustomWatermarkAsset[] {
  return [asset, ...assets.filter((item) => item.id !== asset.id)]
}

export function addCustomWatermarkAssets(
  assets: CustomWatermarkAsset[],
  additions: CustomWatermarkAsset[],
): CustomWatermarkAsset[] {
  const seen = new Set<string>()
  return [...additions, ...assets].filter((asset) => {
    if (seen.has(asset.id)) return false
    seen.add(asset.id)
    return true
  })
}

export function removeCustomWatermarkAsset(
  assets: CustomWatermarkAsset[],
  assetId: string,
): CustomWatermarkAsset[] {
  return assets.filter((item) => item.id !== assetId)
}
