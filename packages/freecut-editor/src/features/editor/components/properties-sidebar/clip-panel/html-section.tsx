import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, LayoutTemplate } from 'lucide-react'

import { Button } from '@freecut/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@freecut/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@freecut/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@freecut/components/ui/tabs'
import { Textarea } from '@freecut/components/ui/textarea'
import {
  useItemsStore,
  useTimelineStore,
} from '@freecut/features/editor/deps/timeline-store'
import type { HtmlItem, TimelineItem } from '@freecut/types/timeline'

import { ColorPicker, NumberInput, PropertyRow, PropertySection } from '../components'
import { FontPicker } from './font-picker'
import './html-section.css'

const MAX_SIMPLE_ELEMENTS = 14
const COMPLEX_TAGS = new Set([
  'svg',
  'canvas',
  'table',
  'video',
  'audio',
  'picture',
  'iframe',
  'object',
  'embed',
  'script',
  'form',
])

type EditableStyle = 'font-family' | 'font-size' | 'font-weight' | 'color'

interface TextTarget {
  key: string
  path: number[]
  label: string
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: string
  color: string
}

interface ContentAnalysis {
  isComplex: boolean
  targets: TextTarget[]
}

const EMPTY_ANALYSIS: ContentAnalysis = { isComplex: false, targets: [] }

function getHtmlItems(items: TimelineItem[]): HtmlItem[] {
  return items.filter((item): item is HtmlItem => item.type === 'html')
}

function getCurrentHtmlItem(id: string): HtmlItem | null {
  const item = useItemsStore.getState().itemById[id]
  return item?.type === 'html' ? item : null
}

function directTextNodes(element: Element): Text[] {
  return Array.from(element.childNodes).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  )
}

function elementPath(element: Element, body: HTMLElement): number[] {
  const path: number[] = []
  let current: Element | null = element
  while (current && current !== body) {
    const parent: Element | null = current.parentElement
    if (!parent) break
    path.unshift(Array.from(parent.children).indexOf(current))
    current = parent
  }
  return path
}

function elementAtPath(body: HTMLElement, path: number[]): Element | null {
  let current: Element = body
  for (const index of path) {
    const next: Element | undefined = Array.from(current.children)[index]
    if (!next) return null
    current = next
  }
  return current
}

function readMatchingStyles(document: Document, css: string, element: Element) {
  const values = new Map<EditableStyle, string>()
  if (!css.trim()) return values

  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  try {
    for (const rule of Array.from(style.sheet?.cssRules ?? [])) {
      const candidate = rule as CSSStyleRule
      if (!candidate.selectorText || !candidate.style) continue
      try {
        if (!element.matches(candidate.selectorText)) continue
      } catch {
        continue
      }
      for (const property of ['font-family', 'font-size', 'font-weight', 'color'] as const) {
        const value = candidate.style.getPropertyValue(property).trim()
        if (value) values.set(property, value)
      }
    }
  } catch {
    // Invalid or unsupported rules remain editable through the advanced panel.
  } finally {
    style.remove()
  }
  return values
}

function firstFontFamily(value: string): string {
  return value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || 'Inter'
}

function readableWeight(value: string): string {
  if (value === 'bold') return '700'
  if (value === 'normal') return '400'
  return /^\d{3}$/.test(value) ? value : '400'
}

function editableColor(value: string): string {
  const normalized = value.trim()
  if (/^#[\da-f]{3,8}$/i.test(normalized)) return normalized
  const channels = normalized.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i,
  )
  if (!channels) return '#ffffff'
  return `#${channels.slice(1, 4).map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel))))
      .toString(16)
      .padStart(2, '0')).join('')}`
}

function analyzeContent(html: string, css: string): ContentAnalysis {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const elements = Array.from(document.body.querySelectorAll('*'))
  const isComplex =
    elements.length > MAX_SIMPLE_ELEMENTS ||
    elements.some((element) => COMPLEX_TAGS.has(element.tagName.toLowerCase()))
  const textElements = elements.filter((element) => directTextNodes(element).length > 0)

  const targets = textElements.map((element) => {
    const path = elementPath(element, document.body)
    const ruleStyles = readMatchingStyles(document, css, element)
    const inline = (element as HTMLElement).style
    const text = directTextNodes(element)
      .map((node) => node.textContent ?? '')
      .join(' ')
      .trim()
    const fontSize = Number.parseFloat(inline.fontSize || ruleStyles.get('font-size') || '48')

    return {
      key: path.join('.'),
      path,
      label: text.length > 24 ? `${text.slice(0, 24)}...` : text,
      text,
      fontFamily: firstFontFamily(inline.fontFamily || ruleStyles.get('font-family') || 'Inter'),
      fontSize: Number.isFinite(fontSize) ? fontSize : 48,
      fontWeight: readableWeight(
        inline.fontWeight || ruleStyles.get('font-weight') || '400',
      ),
      color: editableColor(inline.color || ruleStyles.get('color') || '#ffffff'),
    }
  })

  return { isComplex, targets }
}

function updateTargetHtml(
  html: string,
  path: number[],
  update: (element: HTMLElement) => void,
): string {
  const isFullDocument = /<\s*(?:!doctype|html|head|body)\b/i.test(html)
  const document = new DOMParser().parseFromString(html, 'text/html')
  const target = elementAtPath(document.body, path)
  if (!(target instanceof HTMLElement)) return html
  update(target)
  return isFullDocument
    ? `<!doctype html>\n${document.documentElement.outerHTML}`
    : document.body.innerHTML
}

function replaceDirectText(element: HTMLElement, value: string) {
  const nodes = directTextNodes(element)
  if (!nodes[0]) return
  nodes[0].textContent = value
  nodes.slice(1).forEach((node) => node.remove())
}

function DraftText({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <Textarea
      aria-label="文字"
      className="html-visual-text-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}

function AdvancedEditor({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <Textarea
      aria-label={label}
      className="html-source-editor"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
  )
}

export function HtmlSection({ items }: { items: TimelineItem[] }) {
  const updateItem = useTimelineStore((state) => state.updateItem)
  const htmlItems = useMemo(() => getHtmlItems(items), [items])
  const item = htmlItems.length === 1 ? htmlItems[0]! : null
  const analysis = useMemo(
    () => (item ? analyzeContent(item.html, item.css) : EMPTY_ANALYSIS),
    [item],
  )
  const [selectedTargetKey, setSelectedTargetKey] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(analysis.isComplex)
  const selectedTarget =
    analysis.targets.find((target) => target.key === selectedTargetKey) ?? analysis.targets[0]

  useEffect(() => {
    if (analysis.isComplex) setAdvancedOpen(true)
  }, [analysis.isComplex, item?.id])

  useEffect(() => {
    if (selectedTarget && selectedTarget.key !== selectedTargetKey) {
      setSelectedTargetKey(selectedTarget.key)
    }
  }, [selectedTarget, selectedTargetKey])

  const patchItem = useCallback(
    (itemId: string, updates: Partial<HtmlItem>) => {
      const current = getCurrentHtmlItem(itemId)
      if (!current) return
      updateItem(itemId, {
        ...updates,
        sourceRevision: (current.sourceRevision ?? 0) + 1,
      })
    },
    [updateItem],
  )

  const patchTarget = useCallback(
    (path: number[], update: (element: HTMLElement) => void) => {
      if (!item) return
      const current = getCurrentHtmlItem(item.id)
      if (!current) return
      const html = updateTargetHtml(current.html, path, update)
      if (html !== current.html) patchItem(item.id, { html })
    },
    [item, patchItem],
  )

  const patchStyle = useCallback(
    (property: EditableStyle, value: string) => {
      if (!selectedTarget) return
      patchTarget(selectedTarget.path, (element) => element.style.setProperty(property, value))
    },
    [patchTarget, selectedTarget],
  )

  if (!item) {
    return <div className="html-source-selection-empty">请选择一个图文图层进行编辑</div>
  }

  return (
    <div className="html-source-panel">
      <PropertySection title="图文内容" icon={LayoutTemplate} defaultOpen={true}>
        <div className="html-source-settings">
          <PropertyRow label="播放方式">
            <Select
              value={item.renderMode}
              onValueChange={(value) =>
                patchItem(item.id, { renderMode: value as HtmlItem['renderMode'] })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="static" className="text-xs">固定画面</SelectItem>
                <SelectItem value="animated" className="text-xs">动画</SelectItem>
              </SelectContent>
            </Select>
          </PropertyRow>

          {analysis.targets.length > 1 && (
            <PropertyRow label="编辑内容">
              <Select value={selectedTarget?.key} onValueChange={setSelectedTargetKey}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {analysis.targets.map((target) => (
                    <SelectItem key={target.key} value={target.key} className="text-xs">
                      {target.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
          )}

          {selectedTarget ? (
            <div className="html-visual-controls">
              <PropertyRow label="文字" className="items-start">
                <DraftText
                  value={selectedTarget.text}
                  onCommit={(text) =>
                    patchTarget(selectedTarget.path, (element) => replaceDirectText(element, text))
                  }
                />
              </PropertyRow>
              <PropertyRow label="字体" className="items-start">
                <FontPicker
                  value={selectedTarget.fontFamily}
                  previewText={selectedTarget.text}
                  onValueChange={(value) => patchStyle('font-family', value)}
                />
              </PropertyRow>
              <PropertyRow label="字号">
                <NumberInput
                  value={selectedTarget.fontSize}
                  onChange={(value) => patchStyle('font-size', `${value}px`)}
                  min={8}
                  max={500}
                  step={1}
                  unit="px"
                  className="w-full"
                />
              </PropertyRow>
              <PropertyRow label="字重">
                <Select
                  value={selectedTarget.fontWeight}
                  onValueChange={(value) => patchStyle('font-weight', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="300">细体</SelectItem>
                    <SelectItem value="400">常规</SelectItem>
                    <SelectItem value="500">中等</SelectItem>
                    <SelectItem value="600">半粗</SelectItem>
                    <SelectItem value="700">粗体</SelectItem>
                    <SelectItem value="800">特粗</SelectItem>
                    <SelectItem value="900">黑体</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyRow>
              <PropertyRow label="颜色">
                <ColorPicker
                  color={selectedTarget.color}
                  onChange={(value) => patchStyle('color', value)}
                  allowAlpha
                />
              </PropertyRow>
            </div>
          ) : (
            <p className="html-visual-empty">当前内容没有可直接编辑的文字</p>
          )}

          {analysis.isComplex && (
            <p className="html-complex-hint">这个图层包含较复杂的排版，可在高级编辑中完整调整</p>
          )}
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="html-advanced-trigger">
              <ChevronRight className="html-advanced-chevron" />
              高级编辑（HTML/CSS）
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="html-advanced-content">
            <Tabs defaultValue="html">
              <TabsList className="grid h-8 w-full grid-cols-2 bg-muted/45 p-0.5">
                <TabsTrigger value="html" className="text-xs font-normal">HTML</TabsTrigger>
                <TabsTrigger value="css" className="text-xs font-normal">CSS</TabsTrigger>
              </TabsList>
              <TabsContent value="html" className="mt-2">
                <AdvancedEditor
                  label="HTML 源码"
                  value={item.html}
                  onCommit={(html) => patchItem(item.id, { html })}
                />
              </TabsContent>
              <TabsContent value="css" className="mt-2">
                <AdvancedEditor
                  label="CSS 源码"
                  value={item.css}
                  onCommit={(css) => patchItem(item.id, { css })}
                />
              </TabsContent>
            </Tabs>
          </CollapsibleContent>
        </Collapsible>
      </PropertySection>
    </div>
  )
}
