import type { DirectorLanPlanSummary, DirectorLanShot } from '../shared/types/directorLab.ts'
import { DIRECTOR_PLAN_ATTRIBUTES } from './directorPlanSync.ts'

export function parseDirectorPlanImport(text: string, fallbackTitle: string, newId: () => string): DirectorLanPlanSummary {
  let title = fallbackTitle.trim() || '导演计划'
  const shots: DirectorLanShot[] = []
  let currentName = ''
  let marked = false
  let duration = 5000
  let attributeName = ''
  let attributeLines: string[] = []
  let attributes: Array<{ name: string; description: string }> = []
  const mainContent: string[] = []
  let readingMainContent = false
  function finishAttribute() {
    if (attributeName) attributes.push({ name: attributeName, description: attributeLines.join('\n').trim() })
    attributeName = ''
    attributeLines = []
  }
  function appendShot(name: string) {
    const id = `shot-${newId()}`
    const aliases = [
      { id: 'content', name: '画面内容', aliases: ['画面内容', '画面说明', '场景', '主体'] },
      { id: 'framing', name: '景别', aliases: ['景别'] },
      { id: 'movement', name: '运镜方式', aliases: ['运镜方式', '运镜说明', '拍摄方式'] },
    ]
    shots.push({
      id, order: shots.length + 1, name, duration_ms: duration, completed_takes: 0, takes: [],
      attributes: aliases.flatMap((field) => {
        const description = attributes.find((attribute) => field.aliases.includes(attribute.name))?.description ?? ''
        return description ? [{ id: `${id}-attribute-${field.id}`, name: field.name, description }] : []
      }),
      remark: attributes.filter((attribute) => !aliases.some((field) => field.aliases.includes(attribute.name)) && attribute.description)
        .map((attribute) => `${attribute.name}：${attribute.description}`).join('\n'),
    })
  }
  function finishShot() {
    if (!currentName) return
    finishAttribute()
    appendShot(currentName)
    currentName = ''
    attributes = []
    duration = 5000
  }
  for (const rawLine of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!rawLine.trim() || rawLine.trim() === '```') continue
    const line = rawLine.trim().replace(/\*\*|__/g, '').trim()
    if (line.startsWith('# ')) { title = line.slice(2).trim(); continue }
    const explicitTitle = /^(?:拍摄计划|计划|标题)[：:]\s*(.+)$/.exec(line)
    if (explicitTitle) { title = explicitTitle[1].trim(); continue }
    const attribute = /^([^:：]{1,48})[：:]\s*(.*)$/.exec(line.replace(/^[-*+]\s+/, ''))
    if (!marked && attribute && ['主要内容', 'main_content', 'main content', 'maincontent'].includes(attribute[1].trim().toLowerCase())) {
      readingMainContent = true
      mainContent.push(attribute[2])
      continue
    }
    if (marked && currentName && attribute) {
      finishAttribute()
      const name = attribute[1].trim()
      const value = attribute[2].trim()
      if (['时长', '建议时长', '目标时长', 'duration', 'duration_ms', 'durationms'].includes(name.toLowerCase())) {
        const match = /^(\d+(?:\.\d+)?)\s*(毫秒|ms|秒钟|秒|s|sec|seconds?)?$/i.exec(value)
        if (match && Number(match[1]) > 0) {
          const milliseconds = ['duration_ms', 'durationms'].includes(name.toLowerCase()) || ['毫秒', 'ms'].includes(match[2]?.toLowerCase())
          duration = Math.min(3600000, Math.max(1000, Math.round(Number(match[1]) * (milliseconds ? 1 : 1000))))
          continue
        }
      }
      attributeName = name
      if (value) attributeLines.push(value)
      continue
    }
    const marker = /^#{2,6}\s+(.+)$/.exec(line) ?? /^\d+[.)、]\s*(.+)$/.exec(line)
      ?? /^镜头[^：:]*[：:]\s*(.*)$/.exec(line) ?? /^[-*+]\s+(.+)$/.exec(line)
    if (marker) {
      readingMainContent = false
      marked = true
      finishShot()
      currentName = marker[1].replace(/^(?:0\d+\s+|\d+\s*[.)、:：-]\s*|[1-9]\d?\s+)/, '').trim()
    } else if (readingMainContent) mainContent.push(line)
    else if (marked && currentName) {
      attributeName ||= '说明'
      attributeLines.push(line)
    } else if (!marked) appendShot(line)
  }
  if (marked) finishShot()
  if (!shots.length) throw new Error('文件中没有可导入的镜头')
  if (shots.length > 500 || title.length > 120 || shots.some((shot) => shot.name.length > 120
    || shot.remark.length > 4000 || shot.attributes.some((attribute) => attribute.description.length > 4000))) {
    throw new Error('计划内容超过限制（最多 500 个镜头，名称 120 字，单项内容 4000 字）')
  }
  const now = new Date().toISOString()
  return { id: `plan-${newId()}`, title: title || fallbackTitle, main_content: mainContent.join('\n').trim(), created_at: now, updated_at: now,
    revision: 0, pending_create: true, attributes: DIRECTOR_PLAN_ATTRIBUTES.map((attribute) => ({ ...attribute })), shot_count: shots.length, completed_shot_count: 0,
    take_count: 0, archive_url: '', source: 'local', shots }
}
