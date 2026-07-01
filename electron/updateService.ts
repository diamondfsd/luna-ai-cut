import { app } from 'electron'

export interface UpdateCheckResult {
  version: string
  downloadUrl: string
  releaseUrl: string
  releaseNotes?: string
  publishedAt?: string
}

const GITCODE_API = 'https://api.gitcode.com/api/v5/repos/diamondfsd/luna-ai-cut-package-release'
const GITCODE_DL = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download'
const GITHUB_REPO = 'diamondfsd/luna-ai-cut'

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

interface GitCodeAsset {
  name: string
  browser_download_url: string
  type: string // "attach" | "source"
}

interface GitCodeRelease {
  tag_name: string
  name: string
  body?: string
  created_at?: string
  assets?: GitCodeAsset[]
}

/**
 * 从 GitCode API 获取最新 Release（含下载链接），无需鉴权
 *
 * 注意：不使用 /releases/latest（GitCode 该接口返回的并非最新 tag），
 * 改为遍历 release 列表找到版本最大的发行版。
 */
async function checkGitCode(): Promise<UpdateCheckResult | null> {
  const res = await fetch(`${GITCODE_API}/releases?per_page=50`)
  if (!res.ok) return null

  const releases: GitCodeRelease[] = await res.json()
  const currentVersion = app.getVersion()

	  // 从新到旧遍历（列表按创建时间升序，reverse 后最新在前）
	  for (const data of releases.reverse()) {
	    const tagName = data.tag_name ?? ''
	    const latestVersion = tagName.replace(/^v/, '')
	    if (compareVersions(latestVersion, currentVersion) <= 0) continue

    // assets 中 type 为 "attach" 的才是上传的安装包，排除 source 包
    const attachAssets = (data.assets ?? []).filter(a => a.type === 'attach')

    // 根据当前操作系统和 CPU 架构选择对应安装包
    // 资产命名示例: LunaAICut-Mac-1.3.3-Installer-arm64.dmg / LunaAICut-Windows-1.3.3-Setup-x64.exe
    const platform = process.platform
    const arch = process.arch // 'arm64' | 'x64'
    const installer = attachAssets.find(a => {
      if (platform === 'win32') return a.name.endsWith('.exe') && a.name.includes('-Windows-')
      if (platform === 'darwin') return a.name.endsWith('.dmg') && a.name.includes(`-${arch}.dmg`)
      return false
    })
    if (!installer) continue // 该版本没有安装包，继续看更早的版本

    // 从 GitHub 获取详细的发布说明（GitCode 只有附件，没有完整内容）
    let releaseNotes: string | undefined
    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tagName}`,
        { headers: { Accept: 'application/vnd.github+json' } },
      )
      if (ghRes.ok) {
        const ghData: any = await ghRes.json()
        releaseNotes = ghData.body?.slice(0, 500) || undefined
      }
    } catch {
      // GitHub 获取失败不影响主流程，用户仍可下载
    }

    // API 返回的 browser_download_url 是 api.gitcode.com 域名（直链可能鉴权）
    // 改用 gitcode.com 的公开下载地址
    const downloadUrl = `${GITCODE_DL}/${tagName}/${installer.name}`

    return {
      version: latestVersion,
      downloadUrl,
      releaseUrl: `https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/tag/${tagName}`,
      releaseNotes,
      publishedAt: data.created_at,
    }
  }

  return null
}

/**
 * 从 GitHub API 获取最新 Release（备用）
 */
async function checkGitHub(): Promise<UpdateCheckResult | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!res.ok) return null

  const data: any = await res.json()
  const tagName: string = data.tag_name ?? ''
  const latestVersion = tagName.replace(/^v/, '')
  const currentVersion = app.getVersion()
  if (compareVersions(latestVersion, currentVersion) <= 0) return null

  const assets: Array<{ name: string; browser_download_url: string }> = data.assets ?? []

  // 根据当前操作系统和 CPU 架构选择对应安装包

  // 资产命名示例: Luna_AI_Cut-v1.3.2-Mac-arm64.dmg / Luna_AI_Cut-v1.3.2-Windows-x64_Setup.exe
  const platform = process.platform
  const arch = process.arch // 'arm64' | 'x64'
  const installer = assets.find(a => {
    if (platform === 'win32') return a.name.endsWith('Setup.exe') && a.name.includes('-Windows-')
    if (platform === 'darwin') return a.name.endsWith('.dmg') && a.name.includes(`-Mac-${arch}`)

  // 资产命名示例: LunaAICut-Mac-1.3.3-Installer-arm64.dmg / LunaAICut-Windows-1.3.3-Setup-x64.exe
  const platform = process.platform
  const arch = process.arch // 'arm64' | 'x64'
  const installer = assets.find(a => {
    if (platform === 'win32') return a.name.endsWith('.exe') && a.name.includes('-Windows-')
    if (platform === 'darwin') return a.name.endsWith('.dmg') && a.name.includes(`-${arch}.dmg`)

    return false
  })

  // 没有安装包文件则不提示更新
  if (!installer) return null

  return {
    version: latestVersion,
    downloadUrl: installer.browser_download_url,
    releaseUrl: data.html_url ?? `https://github.com/${GITHUB_REPO}/releases/tag/${tagName}`,
    releaseNotes: data.body?.slice(0, 500) || undefined,
    publishedAt: data.published_at,
  }
}

/**
 * 检查更新：优先 GitCode（国内快速、无需鉴权），GitHub 作为备用
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  try {
    const gitcodeResult = await checkGitCode()
    if (gitcodeResult) return gitcodeResult
  } catch {
    // GitCode 失败，继续尝试 GitHub
  }

  try {
    return await checkGitHub()
  } catch {
    return null
  }
}
