// 根据生成的发布说明同步首页「最新版本亮点」。
function renderLatestChangelog() {
  if (typeof CHANGELOG_DATA === 'undefined' || !CHANGELOG_DATA.length) return

  const latest = CHANGELOG_DATA[0]
  const version = document.getElementById('latest-changelog-version')
  const title = document.getElementById('latest-changelog-title')
  const summary = document.getElementById('latest-changelog-summary')
  const meta = document.getElementById('latest-changelog-meta')
  const body = document.createElement('div')
  body.innerHTML = latest.bodyHtml

  const firstHeading = body.querySelector('h2, h3, h4')
  const highlights = [...body.querySelectorAll('li')]
    .slice(0, 3)
    .map((item) => item.textContent.trim().replace(/[。；;]+$/, ''))

  if (version) version.textContent = `v${latest.version}`
  if (title) title.textContent = firstHeading?.textContent.trim() || '本次更新内容'
  if (summary && highlights.length) summary.textContent = `${highlights.join('；')}。`
  if (meta) meta.textContent = `共收录 ${CHANGELOG_DATA.length} 个版本的发布说明`
}

renderLatestChangelog()
