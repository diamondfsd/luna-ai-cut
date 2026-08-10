import type { AgentHtmlViewport } from './types'

export const MAX_HTML_SOURCE_LENGTH = 500_000
export const MAX_CSS_SOURCE_LENGTH = 500_000

export interface HtmlSourceInput {
  html: string
  css: string
  viewport?: AgentHtmlViewport
}

export interface HtmlSourceValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function validateViewport(viewport: AgentHtmlViewport | undefined, errors: string[]): void {
  if (!viewport) return
  if (!Number.isInteger(viewport.width) || viewport.width < 1 || viewport.width > 8192) {
    errors.push('HTML 视口宽度必须是 1 到 8192 之间的整数。')
  }
  if (!Number.isInteger(viewport.height) || viewport.height < 1 || viewport.height > 8192) {
    errors.push('HTML 视口高度必须是 1 到 8192 之间的整数。')
  }
  if (!Number.isFinite(viewport.deviceScaleFactor) || viewport.deviceScaleFactor < 0.25 || viewport.deviceScaleFactor > 4) {
    errors.push('HTML 视口缩放倍率必须在 0.25 到 4 之间。')
  }
}

function inspectHtml(html: string, errors: string[], warnings: string[]): void {
  if (typeof DOMParser === 'undefined') {
    warnings.push('当前环境只能进行基础源码检查，完整解析将在渲染阶段完成。')
    return
  }

  const document = new DOMParser().parseFromString(html, 'text/html')
  const blockedElement = document.querySelector('script, iframe, object, embed')
  if (blockedElement) errors.push(`HTML 不能包含 <${blockedElement.tagName.toLowerCase()}>。`)

  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.getAttributeNames()) {
      const value = element.getAttribute(attribute)?.trim() ?? ''
      if (attribute.toLowerCase().startsWith('on')) {
        errors.push(`HTML 不能包含事件属性 ${attribute}。`)
      }
      if (/^javascript:/i.test(value)) errors.push('HTML 不能包含 javascript: 地址。')
    }
  }
}

function inspectCss(css: string, errors: string[], warnings: string[]): void {
  if (/<\/style/i.test(css)) errors.push('CSS 不能包含 </style 结束标签。')
  if (/url\(\s*(['"]?)javascript:/i.test(css)) errors.push('CSS 不能包含 javascript: 地址。')
  if (typeof CSSStyleSheet === 'undefined') {
    warnings.push('当前环境未提供 CSS 解析器，完整解析将在渲染阶段完成。')
    return
  }
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
  } catch (error) {
    errors.push(error instanceof Error ? `CSS 无法解析：${error.message}` : 'CSS 无法解析。')
  }
}

export function validateHtmlSource(input: HtmlSourceInput): HtmlSourceValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!input.html.trim()) errors.push('HTML 内容不能为空。')
  if (input.html.length > MAX_HTML_SOURCE_LENGTH) errors.push('HTML 内容超过 500000 个字符。')
  if (input.css.length > MAX_CSS_SOURCE_LENGTH) errors.push('CSS 内容超过 500000 个字符。')
  validateViewport(input.viewport, errors)
  inspectHtml(input.html, errors, warnings)
  inspectCss(input.css, errors, warnings)
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

export function assertValidHtmlSource(input: HtmlSourceInput): void {
  const result = validateHtmlSource(input)
  if (!result.valid) throw new Error(result.errors[0] ?? 'HTML/CSS 内容无法使用。')
}

export async function hashHtmlSource(html: string, css: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${html.length}:${html}\n${css}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
