import type { RuntimeResourceProgress } from './runtimeResourceService.js'

export interface BiRefNetMpsResourceProgress {
  label: string
  percent: number
}

export function mapBiRefNetMpsProgress(
  progress: RuntimeResourceProgress,
  label: string,
  completedArchiveBytes: number,
  totalArchiveBytes: number,
  currentArchiveBytes: number,
): BiRefNetMpsResourceProgress {
  const downloadRatio = progress.totalBytes > 0
    ? Math.max(0, Math.min(1, progress.completedBytes / progress.totalBytes))
    : 0
  const completedCurrentBytes = progress.phase === 'download'
    ? currentArchiveBytes * downloadRatio
    : currentArchiveBytes
  const phaseLabel = progress.phase === 'download'
    ? `正在下载${label}`
    : progress.phase === 'install'
      ? `正在安装${label}`
      : `正在校验${label}`

  return {
    label: phaseLabel,
    percent: Math.round((completedArchiveBytes + completedCurrentBytes) / totalArchiveBytes * 100),
  }
}
