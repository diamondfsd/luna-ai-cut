/** generate-changelog.cjs
 *
 *  扫描项目根目录下的 RELEASE_NOTES_*.md 文件，
 *  生成 landing/changelog-data.js，供 changelog.html 读取。
 *
 *  用法：node landing/generate-changelog.cjs
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(__dirname, 'changelog-data.js')

// ── 文件排序 ──────────────────────────────
const files = fs.readdirSync(ROOT)
  .filter(f => /^RELEASE_NOTES_v[\d.]+(-hot\.\d+)?\.md$/.test(f))
  .sort((a, b) => {
    const ta = a.replace(/^RELEASE_NOTES_v/, '').replace(/\.md$/, '')
    const tb = b.replace(/^RELEASE_NOTES_v/, '').replace(/\.md$/, '')
    const parse = (t) => {
      const m = t.match(/^(\d+)\.(\d+)\.(\d+)(?:-hot\.(\d+))?$/)
      if (!m) return [0, 0, 0, 0]
      return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] ? parseInt(m[4]) : 0]
    }
    const va = parse(ta), vb = parse(tb)
    for (let i = 0; i < 4; i++) if (va[i] !== vb[i]) return vb[i] - va[i]
    return 0
  })

// ── Md → Html（逐行解析）────────────────
function mdToHtml(md) {
  const lines = md.split('\n')
  const out = []
  let inList = false
  let inP = false

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
  }
  function closeList() { if (inList) { out.push('</ul>'); inList = false } }
  function flushP() { if (inP) { out.push('</p>'); inP = false } }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const processed = inline(raw)

    // 代码块
    if (/^```/.test(raw)) {
      flushP(); closeList()
      const codeLines = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(esc(lines[i])); i++ }
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    // 标题 # → h2, ## → h3, ### → h4
    if (/^#{1,3}\s/.test(raw)) {
      flushP(); closeList()
      const level = raw.match(/^#+/)[0].length
      const tag = `h${level + 1}`
      out.push(`<${tag}>${inline(raw.replace(/^#+\s+/, ''))}</${tag}>`)
      continue
    }

    // 列表项
    if (/^-\s+/.test(raw)) {
      flushP()
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(raw.replace(/^-\s+/, ''))}</li>`)
      continue
    }

    // 空行
    if (raw.trim() === '') { flushP(); closeList(); continue }

    // 段落
    closeList()
    if (!inP) { out.push('<p>'); inP = true } else out.push('<br>')
    out.push(processed)
  }

  flushP(); closeList()
  return out.join('\n')
}

// ── 读取并转换各文件 ──────────────────────
const entries = files.map((f) => {
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf-8').trim()
  const lines = raw.split('\n')
  const titleLine = lines[0].replace(/^#\s*/, '')
  const bodyMd = lines.slice(1).join('\n').trim()
  const bodyHtml = mdToHtml(bodyMd)
  const version = f.replace('RELEASE_NOTES_v', '').replace('.md', '')
  const isHotfix = f.includes('-hot.')
  return { version, title: titleLine, bodyHtml, isHotfix }
})

// ── 写出 JS 数据文件 ──────────────────────
const js = `// 自动生成 — 由 generate-changelog.cjs 创建
// 用法: node landing/generate-changelog.cjs
const CHANGELOG_DATA = ${JSON.stringify(entries, null, 2)}
`

fs.writeFileSync(OUTPUT, js, 'utf-8')
console.log(`✅ 已生成 ${OUTPUT}（共 ${entries.length} 条发布说明）`)
