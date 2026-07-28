import type { CustomWatermarkAsset } from './types'

export function normalizeWatermarkSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\p{Mark}\p{Separator}\p{Punctuation}\p{Symbol}]/gu, '')
}

function watermarkSearchTerms(value: string): string[] {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/\p{Mark}/gu, '')
    .split(/[\p{Separator}\p{Punctuation}\p{Symbol}]+/u)
    .filter(Boolean)
}

function differsBySingleEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false

  if (left.length === right.length) {
    const mismatches: number[] = []
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index)
      if (mismatches.length > 2) return false
    }
    if (mismatches.length <= 1) return true
    const [first, second] = mismatches
    return second === first + 1
      && left[first] === right[second]
      && left[second] === right[first]
  }

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shorterIndex = 0
  let longerIndex = 0
  let skipped = false
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1
      longerIndex += 1
    } else {
      if (skipped) return false
      skipped = true
      longerIndex += 1
    }
  }
  return true
}

export function matchesWatermarkFileName(fileName: string, query: string): boolean {
  const normalizedQuery = normalizeWatermarkSearchText(query)
  if (normalizedQuery.length === 0) return true
  if (normalizeWatermarkSearchText(fileName).includes(normalizedQuery)) return true

  const fileNameTerms = watermarkSearchTerms(fileName)
  return watermarkSearchTerms(query).every((queryTerm) => fileNameTerms.some((fileNameTerm) => (
    fileNameTerm.includes(queryTerm)
    || (queryTerm.length >= 4 && differsBySingleEdit(fileNameTerm, queryTerm))
  )))
}

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
