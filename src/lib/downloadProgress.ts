import type { DownloadProgress } from '../shared/types'

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function downloadProgressPercent(progress: DownloadProgress): number {
  if (progress.status === 'done' || progress.status === 'exists') return 100
  if (progress.total !== null && progress.total > 0) {
    return clampPercent((progress.downloaded / progress.total) * 100)
  }
  return clampPercent(progress.percent ?? 0)
}

export function overallDownloadProgress(entries: DownloadProgress[]): number {
  if (entries.length === 0) return 0

  const hasUnknownTotal = entries.some((progress) => progress.total === null || progress.total <= 0)
  if (hasUnknownTotal) {
    return entries.reduce((sum, progress) => sum + downloadProgressPercent(progress), 0) / entries.length
  }

  const totalBytes = entries.reduce((sum, progress) => sum + (progress.total ?? 0), 0)
  const downloadedBytes = entries.reduce((sum, progress) => sum + progress.downloaded, 0)
  return totalBytes > 0 ? clampPercent((downloadedBytes / totalBytes) * 100) : 0
}
