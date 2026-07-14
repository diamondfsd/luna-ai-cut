// Luna AI Cut — Landing Page Script
//
// 每次本地发版后，deploy-release.sh 会自动更新下方
// LATEST_RELEASE 中的地址，确保首页展示最新下载链接。
// ============================================================

// ★ 由 deploy-release.sh 自动更新 ★
const LATEST_RELEASE = {
  tag: 'v1.5.0',
  label: 'v1.5.0',
  gitcode_mac_arm: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.5.0/LunaAICut-Mac-1.5.0-Installer-arm64.dmg',
  gitcode_mac_x64: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.5.0/LunaAICut-Mac-1.5.0-Installer-x64.dmg',
  gitcode_win: 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/v1.5.0/LunaAICut-Windows-1.5.0-Setup-x64.exe',
}

// ── 版本号渲染 ──────────────────────────────────────────
const versionEl = document.getElementById('current-version')
if (versionEl) versionEl.textContent = LATEST_RELEASE.label

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

// ── 多页面 App Mockup ─────────────────────────────
// 模拟 Luna AI Cut 的完整 app 界面：设备连接 / 素材库 / 工作台
// ──────────────────────────────────────────────────

const PAGE_RENDERERS = {
  // ═══════════════════════════════════════════════════
  // 1. 设备连接
  // ═══════════════════════════════════════════════════
  connect: () => `
    <div class="mockup-scene">
      <div class="mockup-connect">
        <div class="mockup-connect-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2997ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="#2997ff" stroke="none"/>
          </svg>
        </div>
        <p class="mockup-connect-hint">连上Luna的Wifi后，单击「开始连接」按钮<br/>（当前仅演示操作，无实际效果）</p>
        <span class="mockup-connect-btn" role="button" tabindex="0">开始连接</span>
      </div>
    </div>
  `,

  // ═══════════════════════════════════════════════════
  // 2. 素材库
  // ═══════════════════════════════════════════════════
  library: () => `
    <div class="mockup-scene">
      <div class="mockup-library">
        <div class="mockup-library-top">
          <div class="mockup-library-header">
            <div class="mockup-library-date" id="mockup-date"></div>
            <div class="mockup-library-chips">
              <span class="mockup-chip active">全部</span>
              <span class="mockup-chip">照片</span>
              <span class="mockup-chip">视频</span>
            </div>
          </div>
          <span class="mockup-library-btn primary">下载选中</span>
        </div>
        <div class="mockup-library-grid">
          <div class="mockup-media-card selected">
            <div class="mockup-media-thumb" style="background:linear-gradient(135deg,#3a3a4e,#5a5a6e)"></div>
            <div class="mockup-media-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
          </div>
          <div class="mockup-media-card">
            <div class="mockup-media-thumb" style="background:linear-gradient(135deg,#4a3a3e,#6e5a5a)"></div>
          </div>
          <div class="mockup-media-card selected">
            <div class="mockup-media-thumb" style="background:linear-gradient(135deg,#3a4a3e,#5a6e5a)"></div>
            <div class="mockup-media-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
          </div>
          <div class="mockup-media-card">
            <div class="mockup-media-thumb" style="background:linear-gradient(135deg,#4e3a4a,#6e5a6a)"></div>
            <div class="mockup-media-badge">Live</div>
          </div>
          <div class="mockup-media-card">
            <div class="mockup-media-thumb" style="background:linear-gradient(135deg,#3a4e4e,#5a6e6e)">
              <div class="mockup-media-play"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg></div>
            </div>
            <div class="mockup-media-duration">0:32</div>
          </div>
          <div class="mockup-media-card downloaded">
            <div class="mockup-media-thumb" style="background:linear-gradient(135deg,#3a3e5e,#5a5e8e)"></div>
            <div class="mockup-media-dl-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2997ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
          </div>
        </div>
        <div class="mockup-library-footer">
          <span class="mockup-library-selected">已选 2 个</span>
        </div>
      </div>
    </div>
  `,

  // ═══════════════════════════════════════════════════
  // 3. 工作台（左: 预览+列表 | 右: 调色）
  // ═══════════════════════════════════════════════════
  workspace: () => `
    <div class="mockup-scene">
      <div class="mockup-ws">
        <div class="mockup-ws-left">
          <div class="mockup-ws-preview">
            <div class="mockup-ws-preview-bg"></div>
            <div class="mockup-ws-preview-controls">
              <span class="mockup-ws-chip active">原图</span>
              <span class="mockup-ws-chip">效果</span>
              <span class="mockup-ws-chip">对比</span>
            </div>
          </div>
          <div class="mockup-ws-filmstrip">
            <div class="mockup-ws-film active" style="background:linear-gradient(135deg,#4a4a5e,#6a6a7e)"></div>
            <div class="mockup-ws-film" style="background:linear-gradient(135deg,#3a4a3e,#5a6a5e)"></div>
            <div class="mockup-ws-film" style="background:linear-gradient(135deg,#4e3a4a,#6e5a6a)"></div>
            <div class="mockup-ws-film" style="background:linear-gradient(135deg,#3a3e5e,#5a5e8e)"></div>
          </div>
        </div>
        <div class="mockup-ws-right">
          <div class="mockup-ws-panel">
            <div class="mockup-ws-panel-title">调色</div>
            <div class="mockup-ws-row"><label>曝光</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:55%"></div><div class="mockup-s-thumb" style="left:55%"></div></div><span class="mockup-s-val">+0.5</span></div>
            <div class="mockup-ws-row"><label>对比度</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:40%"></div><div class="mockup-s-thumb" style="left:40%"></div></div><span class="mockup-s-val">-0.3</span></div>
            <div class="mockup-ws-row"><label>饱和度</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:70%"></div><div class="mockup-s-thumb" style="left:70%"></div></div><span class="mockup-s-val">+0.8</span></div>
            <div class="mockup-ws-row"><label>色温</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:45%"></div><div class="mockup-s-thumb" style="left:45%"></div></div><span class="mockup-s-val">-0.2</span></div>
            <div class="mockup-ws-divider"></div>
            <div class="mockup-ws-row"><label>水印</label>
              <div class="mockup-ws-wm-grid">
                <span></span><span></span><span></span>
                <span></span><span class="active"></span><span></span>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
}

// 工作台子工具渲染
const WS_SUB_RENDERERS = {
  crop: () => `
    <div class="mockup-ws-crop">
      <div class="mockup-ws-crop-frame">
        <div class="mockup-ws-crop-lines">
          <div class="mockup-ws-cline-x" style="top:33.3%"></div>
          <div class="mockup-ws-cline-x" style="top:66.6%"></div>
          <div class="mockup-ws-cline-y" style="left:33.3%"></div>
          <div class="mockup-ws-cline-y" style="left:66.6%"></div>
        </div>
        <div class="mockup-ws-handle" style="top:-5px;left:-5px"></div>
        <div class="mockup-ws-handle" style="top:-5px;right:-5px"></div>
        <div class="mockup-ws-handle" style="bottom:-5px;left:-5px"></div>
        <div class="mockup-ws-handle" style="bottom:-5px;right:-5px"></div>
      </div>
      <div class="mockup-ws-ratios">
        <span class="mockup-ws-ratio active">16:9</span>
        <span class="mockup-ws-ratio">4:3</span>
        <span class="mockup-ws-ratio">1:1</span>
        <span class="mockup-ws-rotate">⟳ 旋转</span>
      </div>
    </div>
  `,
  color: () => `
    <div class="mockup-ws-color">
      <div class="mockup-ws-slider"><label>曝光</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:55%"></div><div class="mockup-s-thumb" style="left:55%"></div></div><span class="mockup-s-val">+0.5</span></div>
      <div class="mockup-ws-slider"><label>对比度</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:40%"></div><div class="mockup-s-thumb" style="left:40%"></div></div><span class="mockup-s-val">-0.3</span></div>
      <div class="mockup-ws-slider"><label>饱和度</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:70%"></div><div class="mockup-s-thumb" style="left:70%"></div></div><span class="mockup-s-val">+0.8</span></div>
      <div class="mockup-ws-slider"><label>色温</label><div class="mockup-s-track"><div class="mockup-s-fill" style="width:45%"></div><div class="mockup-s-thumb" style="left:45%"></div></div><span class="mockup-s-val">-0.2</span></div>
    </div>
  `,
  curve: () => `
    <div class="mockup-ws-curve">
      <svg viewBox="0 0 200 160">
        <line x1="0" y1="0" x2="200" y2="0" stroke="rgba(255,255,255,0.05)"/>
        <line x1="0" y1="40" x2="200" y2="40" stroke="rgba(255,255,255,0.05)"/>
        <line x1="0" y1="80" x2="200" y2="80" stroke="rgba(255,255,255,0.05)"/>
        <line x1="0" y1="120" x2="200" y2="120" stroke="rgba(255,255,255,0.05)"/>
        <line x1="0" y1="0" x2="0" y2="160" stroke="rgba(255,255,255,0.05)"/>
        <line x1="50" y1="0" x2="50" y2="160" stroke="rgba(255,255,255,0.05)"/>
        <line x1="100" y1="0" x2="100" y2="160" stroke="rgba(255,255,255,0.05)"/>
        <line x1="150" y1="0" x2="150" y2="160" stroke="rgba(255,255,255,0.05)"/>
        <line x1="0" y1="160" x2="200" y2="0" stroke="rgba(255,255,255,0.1)" stroke-dasharray="4,4"/>
        <path d="M0,160 C60,130 60,60 100,80 C140,100 140,30 200,0" fill="none" stroke="#2997ff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="40" cy="112" r="4.5" fill="#2997ff" stroke="#fff" stroke-width="1.5"/>
        <circle cx="100" cy="80" r="4.5" fill="#2997ff" stroke="#fff" stroke-width="1.5"/>
        <circle cx="155" cy="50" r="4.5" fill="#2997ff" stroke="#fff" stroke-width="1.5"/>
      </svg>
      <div class="mockup-ws-channels">
        <span class="mockup-ws-channel active">RGB</span>
        <span class="mockup-ws-channel">R</span>
        <span class="mockup-ws-channel">G</span>
        <span class="mockup-ws-channel">B</span>
      </div>
    </div>
  `,
  watermark: () => `
    <div class="mockup-ws-watermark">
      <div class="mockup-wm-section">
        <label>位置</label>
        <div class="mockup-wm-grid">
          <span></span><span></span><span></span>
          <span></span><span class="active"></span><span></span>
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="mockup-wm-section">
        <label>大小</label>
        <div class="mockup-wm-slider">
          <span>小</span><div class="mockup-s-track"><div class="mockup-s-fill" style="width:60%"></div><div class="mockup-s-thumb" style="left:60%"></div></div><span>大</span>
        </div>
      </div>
      <div class="mockup-wm-section">
        <label>透明度</label>
        <div class="mockup-wm-slider">
          <span>0%</span><div class="mockup-s-track"><div class="mockup-s-fill" style="width:35%"></div><div class="mockup-s-thumb" style="left:35%"></div></div><span>100%</span>
        </div>
      </div>
    </div>
  `,
}

// ── 页面切换 ──
function renderPage(pageId) {
  const content = document.getElementById('mockup-content')
  if (!content || !PAGE_RENDERERS[pageId]) return

  // 移除旧内容
  const oldScene = content.querySelector('.mockup-scene')
  if (oldScene) oldScene.remove()

  // 渲染新内容
  const wrapper = document.createElement('div')
  wrapper.innerHTML = PAGE_RENDERERS[pageId]()
  const scene = wrapper.firstElementChild
  if (!scene) return

  // 先插 gradient 再插 scene（用 insertBefore 使 gradient 在 scene 前面）
  const gradient = content.querySelector('.mockup-gradient')
  if (gradient) {
    gradient.after(scene)
  } else {
    content.appendChild(scene)
  }

  // 更新 tab
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId)
  })

  // 如果是素材库，渲染日期
  if (pageId === 'library') {
    const dateEl = document.getElementById('mockup-date')
    if (dateEl) {
      const now = new Date()
      dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
    }
  }

  // 如果是工作台，初始化子工具事件
  if (pageId === 'workspace') {
    initWsTools()
  }
}

// ── 工作台子工具切换 ──
function renderWsSubTool(toolId) {
  const body = document.querySelector('#mockup-ws-preview .mockup-ws-body')
  if (!body || !WS_SUB_RENDERERS[toolId]) return

  body.innerHTML = WS_SUB_RENDERERS[toolId]()

  // 更新子工具状态
  document.querySelectorAll('[data-ws-tool]').forEach(el => {
    el.classList.toggle('active', el.dataset.wsTool === toolId)
  })
}

function initWsTools() {
  // 子工具点击
  document.querySelectorAll('[data-ws-tool]').forEach(el => {
    el.addEventListener('click', () => renderWsSubTool(el.dataset.wsTool))
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderWsSubTool(el.dataset.wsTool) }
    })
  })
  // 默认选中裁剪
  renderWsSubTool('crop')
}

// ── 页面切换数据属性 ──
// ── DOMContentLoaded 内追加 ──
document.addEventListener('DOMContentLoaded', () => {
  // 页面 tab 点击
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', () => renderPage(el.dataset.page))
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderPage(el.dataset.page) }
    })
  })

  // 初始渲染
  renderPage('connect')
})
