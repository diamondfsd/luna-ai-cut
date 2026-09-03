import { app } from 'electron'
import {
  compareReleaseVersions,
  releaseChannelForVersion,
  releaseVersionFromTag,
  type ReleaseChannel,
} from '../../src/shared/hotUpdateCompatibility'
import { logMainError, logMainInfo, logMainWarn } from './loggerService'

export interface UpdateCheckResult {
  version: string
  downloadUrl: string
  releaseUrl: string
  releaseNotes?: string
  publishedAt?: string
  channel?: 'stable' | 'beta'
}

const GITCODE_API = 'https://api.gitcode.com/api/v5/repos/diamondfsd/luna-ai-cut-package-release'
const GITCODE_DL = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download'
const GITCODE_WEB = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases'
const GITHUB_REPO = 'diamondfsd/luna-ai-cut'

interface GitCodeAsset {
  name: string
  browser_download_url?: string
  type?: string // "attach" | "source"
}

interface GitCodeRelease {
  tag_name?: string
  name?: string
  body?: string
  created_at?: string
  assets?: GitCodeAsset[]
}

interface GitHubRelease {
  tag_name?: string
  body?: string
  published_at?: string
  html_url?: string
  prerelease?: boolean
  draft?: boolean
  assets?: Array<{ name: string; browser_download_url: string }>
}

function installerForAssets(assets: GitCodeAsset[] | Array<{ name: string }>): { name: string } | null {
  const platform = process.platform
  const arch = process.arch
  const installer = assets.find((asset) => {
    if (platform === 'win32') return asset.name.endsWith('.exe') && asset.name.includes('-Windows-')
    if (platform === 'darwin') return asset.name.endsWith('.dmg') && asset.name.includes('-Mac-') && asset.name.includes(`-${arch}.dmg`)
    return false
  })
  return installer ?? null
}

function githubVersionFromTag(tag: string): ReleaseChannel | null {
  return releaseVersionFromTag(tag)
}

async function releaseNotesForTag(tagName: string): Promise<string | undefined> {
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tagName}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    )
    if (!ghRes.ok) return undefined
    const ghData = await ghRes.json() as GitHubRelease
    return ghData.body?.slice(0, 500) || undefined
  } catch (error) {
    logMainWarn('[更新] 获取发布说明失败', {
      tagName,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * 从 GitCode 获取当前通道的最新安装包。
 * 稳定版和 beta 版都读取对应的 vX.Y.Z[-beta.N] Release。
 */
async function checkGitCode(currentVersion: string): Promise<UpdateCheckResult | null> {
  const current = releaseChannelForVersion(currentVersion)
  if (!current) {
    logMainWarn('[更新] 当前版本不在支持的更新通道中', { currentVersion })
    return null
  }

  const res = await fetch(`${GITCODE_API}/releases?per_page=100`)
  if (!res.ok) {
    logMainWarn('[更新] GitCode 查询失败', { status: res.status, channel: current.channel })
    return null
  }

  const releases = await res.json() as GitCodeRelease[]
  const candidates = releases
    .map((release) => {
      const parsed = release.tag_name ? releaseVersionFromTag(release.tag_name) : null
      return { release, parsed }
    })
    .filter(({ parsed }) => parsed?.channel === current.channel && parsed !== null)
    .sort((left, right) => compareReleaseVersions(right.parsed!.version, left.parsed!.version))

  for (const { release, parsed } of candidates) {
    if (!parsed || compareReleaseVersions(parsed.version, current.version) <= 0) continue
    const installer = installerForAssets((release.assets ?? []).filter((asset) => asset.type === 'attach' || asset.type === undefined))
    if (!installer) continue

    const githubTag = `v${parsed.version}`
    return {
      version: parsed.version,
      channel: parsed.channel,
      downloadUrl: `${GITCODE_DL}/${release.tag_name}/${installer.name}`,
      releaseUrl: `${GITCODE_WEB}/${release.tag_name}`,
      releaseNotes: await releaseNotesForTag(githubTag),
      publishedAt: release.created_at,
    }
  }

  return null
}

/** 从 GitHub 获取当前通道的最新安装包，作为 GitCode 备用源。 */
async function checkGitHub(currentVersion: string): Promise<UpdateCheckResult | null> {
  const current = releaseChannelForVersion(currentVersion)
  if (!current) return null

  const endpoint = current.channel === 'stable'
    ? `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    : `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`
  const res = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) {
    logMainWarn('[更新] GitHub 查询失败', { status: res.status, channel: current.channel })
    return null
  }

  const payload = await res.json() as GitHubRelease | GitHubRelease[]
  const releases = Array.isArray(payload) ? payload : [payload]
  const candidates = releases
    .filter((release) => !release.draft && (current.channel === 'beta' ? release.prerelease : !release.prerelease))
    .map((release) => ({ release, parsed: release.tag_name ? githubVersionFromTag(release.tag_name) : null }))
    .filter(({ parsed }) => parsed?.channel === current.channel && parsed !== null)
    .sort((left, right) => compareReleaseVersions(right.parsed!.version, left.parsed!.version))

  for (const { release, parsed } of candidates) {
    if (!parsed || compareReleaseVersions(parsed.version, current.version) <= 0) continue
    const installer = installerForAssets(release.assets ?? [])
    if (!installer) continue
    return {
      version: parsed.version,
      channel: parsed.channel,
      downloadUrl: release.assets?.find((asset) => asset.name === installer.name)?.browser_download_url ?? '',
      releaseUrl: release.html_url ?? `https://github.com/${GITHUB_REPO}/releases/tag/${release.tag_name}`,
      releaseNotes: release.body?.slice(0, 500) || undefined,
      publishedAt: release.published_at,
    }
  }
  return null
}

/** 手动调用时检查更新；不会在启动时自动执行，也不会自动下载或安装。 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  const currentVersion = app.getVersion()
  const current = releaseChannelForVersion(currentVersion)
  logMainInfo('[更新] 开始查询', {
    currentVersion,
    channel: current?.channel ?? 'unsupported',
    releaseTag: current?.releaseTag,
  })

  try {
    const gitcodeResult = await checkGitCode(currentVersion)
    if (gitcodeResult) {
      logMainInfo('[更新] GitCode 发现新版本', { version: gitcodeResult.version, channel: gitcodeResult.channel })
      return gitcodeResult
    }
  } catch (error) {
    logMainWarn('[更新] GitCode 查询异常，切换备用源', { error: error instanceof Error ? error.message : String(error) })
  }

  try {
    const githubResult = await checkGitHub(currentVersion)
    logMainInfo('[更新] GitHub 查询完成', { available: Boolean(githubResult), version: githubResult?.version, channel: githubResult?.channel })
    return githubResult
  } catch (error) {
    logMainError('[更新] GitHub 查询异常', { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}
