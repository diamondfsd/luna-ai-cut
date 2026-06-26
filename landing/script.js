// Luna AI Cut — Landing Page Script
//
// 每次本地发版后，deploy-release.sh 会自动更新下方
// LATEST_RELEASE 中的地址，确保首页展示最新下载链接。
// ============================================================

// ★ 由 deploy-release.sh 自动更新 ★
const LATEST_RELEASE = {
  tag: 'v1.2.14',
  gitcode_mac: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.2.14/LunaAICut-Mac-1.2.14-Installer.dmg',
  gitcode_win: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.2.14/LunaAICut-Windows-1.2.14-Setup.exe',
}

// ── 版本号渲染 ──────────────────────────────────────────
const versionEl = document.getElementById('current-version')
if (versionEl) versionEl.textContent = LATEST_RELEASE.tag

// ── 地区检测 ──────────────────────────────────────────
const isChineseUser =
  navigator.language.startsWith('zh') ||
  (navigator.languages && navigator.languages.some((l) => l.startsWith('zh')))

// ── 工具函数 ──────────────────────────────────────────
function isDmg(name) {
  return /\.dmg$/i.test(name)
}
function isSetupExe(name) {
  return /Setup.*\.exe$/i.test(name) || /LunaAICut.*\.exe$/i.test(name)
}

// ── DOM 引用 ──────────────────────────────────────────
const macCard = document.getElementById('dl-mac')
const winCard = document.getElementById('dl-win')
const macRegion = document.getElementById('dl-mac-region')
const winRegion = document.getElementById('dl-win-region')

document.addEventListener('DOMContentLoaded', () => {
  // ── 平滑滚动 ──
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'))
      if (target) {
        e.preventDefault()
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  })

  // ── 当前日期 ──
  const dateEl = document.getElementById('mockup-date')
  if (dateEl) {
    const now = new Date()
    dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  }

  // ── 设置下载链接 ──
  setDownloadLinks()
})

// ── 根据地区设置下载链接 ──────────────────────────────
function setDownloadLinks() {
  const ua = navigator.userAgent.toLowerCase()
  const isMac = /macintosh|mac os x/.test(ua)

  // 高亮当前平台
  if (isMac && macCard) {
    macCard.style.borderColor = '#2997ff'
    macCard.style.background = 'rgba(41, 151, 255, 0.08)'
  } else if (!isMac && winCard) {
    winCard.style.borderColor = '#2997ff'
    winCard.style.background = 'rgba(41, 151, 255, 0.08)'
  }

  // 优先使用 embed 的地址，否则 fallback 到 GitCode 仓库页
  const macUrl =
    LATEST_RELEASE.gitcode_mac ||
    'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases'
  const winUrl =
    LATEST_RELEASE.gitcode_win ||
    'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases'

  // 地区标记文字
  const regionLabel = isChineseUser ? '🇨🇳 国内加速' : '🌐 GitHub'

  if (macCard) {
    macCard.href = macUrl
  }
  if (winCard) {
    winCard.href = winUrl
  }
  if (macRegion) {
    macRegion.textContent = regionLabel
  }
  if (winRegion) {
    winRegion.textContent = regionLabel
  }

  // ── API Fallback ──
  fetchGitHubRelease()
}

// ── GitHub API: 获取最新 Release ──────────────────────
function fetchGitHubRelease() {
  fetch('https://api.github.com/repos/diamondfsd/luna-ai-cut/releases/latest')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch release')
      return res.json()
    })
    .then((data) => {
      const assets = data.assets || []
      const macAsset = assets.find((a) => isDmg(a.name))
      const winAsset = assets.find((a) => isSetupExe(a.name))

      // 国际用户走 GitHub 直链
      if (!isChineseUser) {
        if (macAsset && macCard) macCard.href = macAsset.browser_download_url
        if (winAsset && winCard) winCard.href = winAsset.browser_download_url
        if (macRegion) macRegion.textContent = '🌐 国际下载'
        if (winRegion) winRegion.textContent = '🌐 国际下载'
      }
    })
    .catch(() => {})
}
