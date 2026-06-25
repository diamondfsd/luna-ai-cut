import { app } from 'electron'

export interface UpdateCheckResult {
  version: string
  downloadUrl: string
  releaseUrl: string
  releaseNotes?: string
  publishedAt?: string
}

/**
 * 简单 semver 比较，返回 1 / 0 / -1
 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/**
 * 从 GitHub API 获取最新 Release 信息，与当前版本对比
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/diamondfsd/luna-ai-cut/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' } },
    )
    if (!res.ok) return null

    const data = await res.json()
    const tagName: string = data.tag_name ?? '' // e.g. "v1.2.1"
    const latestVersion = tagName.replace(/^v/, '')

    // 对比版本
    const currentVersion = app.getVersion()
    if (compareVersions(latestVersion, currentVersion) <= 0) return null

    // 找安装包资源（macOS dmg 或 Windows Setup exe）
    const assets: Array<{ name: string; browser_download_url: string }> = data.assets ?? []
    const installer = assets.find(
      a =>
        (a.name.endsWith('.dmg') && a.name.includes('-Mac-')) ||
        (a.name.endsWith('Setup.exe') && a.name.includes('-Windows-')),
    )

    return {
      version: latestVersion,
      downloadUrl: installer?.browser_download_url ?? '',
      releaseUrl: data.html_url ?? `https://github.com/diamondfsd/luna-ai-cut/releases/tag/${tagName}`,
      releaseNotes: data.body?.slice(0, 500) || undefined,
      publishedAt: data.published_at,
    }
  } catch {
    return null
  }
}
