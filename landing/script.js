// Luna AI Cut — Landing Page Script
//
// 每次本地发版后，deploy-release.sh 会自动更新下方
// LATEST_RELEASE 中的地址，确保首页展示最新下载链接。
// ============================================================

// ★ 由 deploy-release.sh 自动更新 ★
const LATEST_RELEASE = {
  tag: 'v1.3.1',
  gitcode_mac_arm: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.3.1/LunaAICut-Mac-1.3.1-Installer-arm64.dmg',
  gitcode_mac_x64: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.3.1/LunaAICut-Mac-1.3.1-Installer-x64.dmg',
  gitcode_win: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.3.1/LunaAICut-Windows-1.3.1-Setup-x64.exe',
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

// ── Mac 芯片类型检测 ──────────────────────────────────
// 优先使用 User-Agent Client Hints（高熵 API），否则回退
let detectedChip = 'arm64' // 默认

async function detectMacChip() {
  try {
    // 只在 Mac 上检测
    if (!/macintosh|mac os x/i.test(navigator.userAgent)) return

    // 方案 1：User-Agent Client Hints 高熵 API（Chrome 90+/Edge 90+）
    if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
      const hints = await navigator.userAgentData.getHighEntropyValues(['architecture'])
      if (hints.architecture === 'arm') {
        detectedChip = 'arm64'
        return
      }
    }

    // 方案 2：检测 Rosetta 2 翻译层（Intel 芯片跑 ARM 编译的浏览器）
    // 如果 navigator.userAgent 包含 "Intel" 则大概率是 Intel
    if (/intel/i.test(navigator.userAgent) || /x86_64|i686|amd64/i.test(navigator.userAgent)) {
      detectedChip = 'x64'
      return
    }

    // 方案 3：platform 检测
    if (navigator.platform && (
      navigator.platform.indexOf('Win') === 0 ||
      navigator.platform.indexOf('Mac') === -1
    )) {
      detectedChip = 'x64'
      return
    }

    // M 系列 Mac 的 platform 通常为 "MacIntel"（兼容模式），无法区分
    // 保持默认 arm64
  } catch {
    // 检测失败，保持默认 arm64
  }
}

// ── DOM 引用 ──────────────────────────────────────────
const macCard = document.getElementById('dl-mac')
const winCard = document.getElementById('dl-win')
const macRegion = document.getElementById('dl-mac-region')
const winRegion = document.getElementById('dl-win-region')
const macChipSelect = document.getElementById('dl-mac-chip')
const macSubtitle = document.getElementById('dl-mac-subtitle')
const macBadge = document.getElementById('dl-mac-badge')

document.addEventListener('DOMContentLoaded', async () => {
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

  // ── 检测芯片类型 ──
  await detectMacChip()
  updateChipUI()

  // ── 芯片选择切换 ──
  if (macChipSelect) {
    macChipSelect.addEventListener('change', () => {
      macChipSelect.dataset.userChanged = 'true'
      updateChipUI()
      setDownloadLinks()
    })
  }

  // ── 设置下载链接 ──
  setDownloadLinks()
})

// ── 更新芯片选择器 UI ─────────────────────────────────
function updateChipUI() {
  if (!macChipSelect) return
  // 如果检测到当前芯片且用户未手动切换过，自动选中
  if (!macChipSelect.dataset.userChanged) {
    macChipSelect.value = detectedChip
  }
  const chip = macChipSelect.value

  // 更新副标题和徽章
  if (macSubtitle) {
    macSubtitle.textContent = chip === 'arm64' ? 'Apple Silicon（M 系列芯片）' : 'Intel 芯片（x64）'
  }
  if (macBadge) {
    macBadge.textContent = chip === 'arm64' ? '.dmg · ARM64 · 免费' : '.dmg · x64 · 免费'
  }
}

// ── 获取当前选中的 Mac 下载 URL ────────────────────────
function currentMacUrl() {
  const chip = macChipSelect ? macChipSelect.value : detectedChip
  return chip === 'arm64' ? LATEST_RELEASE.gitcode_mac_arm : LATEST_RELEASE.gitcode_mac_x64
}

// ── 根据地区设置下载链接 ──────────────────────────────
function setDownloadLinks() {
  const ua = navigator.userAgent.toLowerCase()
  const isMac = /macintosh|mac os x/.test(ua)

  // 高亮当前平台
  if (isMac && macCard) {
    macCard.style.borderColor = '#2997ff'
    macCard.style.background = 'rgba(41, 151, 255, 0.08)'
    // 显示芯片选择器
    if (macChipSelect) macChipSelect.style.display = 'inline-block'
  } else if (!isMac && winCard) {
    winCard.style.borderColor = '#2997ff'
    winCard.style.background = 'rgba(41, 151, 255, 0.08)'
  }

  // 优先使用 embed 的地址，否则 fallback 到 GitCode 仓库页
  const macUrl =
    currentMacUrl() ||
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
      const macArmAsset = assets.find((a) => /-arm64\.dmg$/i.test(a.name))
      const macX64Asset = assets.find((a) => /-x64\.dmg$/i.test(a.name))
      const winAsset = assets.find((a) => isSetupExe(a.name))

      // 国际用户走 GitHub 直链
      if (!isChineseUser) {
        if (macArmAsset && macX64Asset && macCard) {
          const chip = macChipSelect ? macChipSelect.value : detectedChip
          macCard.href = chip === 'arm64'
            ? macArmAsset.browser_download_url
            : macX64Asset.browser_download_url
        }
        if (winAsset && winCard) winCard.href = winAsset.browser_download_url
        if (macRegion) macRegion.textContent = '🌐 国际下载'
        if (winRegion) winRegion.textContent = '🌐 国际下载'
      }
    })
    .catch(() => {})
}
