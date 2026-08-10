import React, { useEffect, useMemo, useRef } from 'react'
import { useCompositionSpace } from '../contexts/composition-space-context'
import { useItemVisualTransform } from '../contexts/item-visual-transform-context'
import { useSequenceContext } from '../deps/player'
import { useVideoConfig } from '../hooks/use-player-compat'
import type { HtmlItem } from '@freecut/types/timeline'

const DEFAULT_VIEWPORT_WIDTH = 1920
const DEFAULT_VIEWPORT_HEIGHT = 1080
const MAX_VIEWPORT_EDGE = 16384

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'nonce-luna-html-runtime'",
  "style-src 'unsafe-inline'",
  'img-src data: blob: luna-asset:',
  'font-src data: blob: luna-asset:',
  'media-src data: blob: luna-asset:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const RUNTIME_CSS = `
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

body {
  position: relative;
}
`

const FORBIDDEN_ELEMENTS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'meta',
  'form',
])
const URL_ATTRIBUTES = new Set([
  'action', 'cite', 'data', 'formaction', 'href', 'ping', 'poster', 'src', 'srcset', 'xlink:href',
])

function isSafeResourceReference(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('data:') || normalized.startsWith('blob:') || normalized.startsWith('#')
}

function sanitizeAuthorHtml(html: string): { body: string; headCss: string } {
  const source = new DOMParser().parseFromString(html, 'text/html')
  for (const element of Array.from(source.querySelectorAll('*'))) {
    if (FORBIDDEN_ELEMENTS.has(element.tagName.toLowerCase())) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name)
      } else if (URL_ATTRIBUTES.has(name) && !isSafeResourceReference(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return {
    body: source.body.innerHTML,
    headCss: Array.from(source.head.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n'),
  }
}

function resolveViewportEdge(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback
  }

  return Math.min(MAX_VIEWPORT_EDGE, Math.max(1, Math.round(value)))
}

function escapeStyleElementContent(css: string): string {
  // A literal closing style tag would otherwise escape the trusted document head.
  return css.replaceAll('<', '\\3C ')
}

function buildSourceDocument(
  html: string,
  css: string,
  width: number,
  height: number,
): string {
  const author = sanitizeAuthorHtml(html ?? '')
  const authorCss = escapeStyleElementContent(`${author.headCss}\n${css ?? ''}`)

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
    <meta name="viewport" content="width=${width}, height=${height}, initial-scale=1">
    <style data-luna-runtime>${RUNTIME_CSS}</style>
    <style data-luna-author>${authorCss}</style>
  </head>
  <body>${author.body}
    <script nonce="luna-html-runtime">
      (() => {
        const applyTime = (timeMs) => {
          const safeTime = Math.max(0, Number(timeMs) || 0)
          document.documentElement.style.setProperty('--luna-time', String(safeTime / 1000))
          document.documentElement.style.setProperty('--luna-time-ms', String(safeTime))
          for (const animation of document.getAnimations()) {
            try {
              animation.pause()
              animation.currentTime = safeTime
            } catch {}
          }
        }
        addEventListener('message', (event) => {
          if (event.data?.type === 'luna-html-seek') applyTime(event.data.timeMs)
        })
        applyTime(0)
      })()
    </script>
  </body>
</html>`
}

/**
 * Renders authored HTML/CSS in an opaque-origin iframe. The empty sandbox is
 * intentional: authored scripts, forms, popups, top-level navigation, and
 * parent access remain disabled while the browser keeps native HTML/CSS layout.
 */
export const HtmlContent: React.FC<{ item: HtmlItem }> = ({ item }) => {
  const compositionSpace = useCompositionSpace()
  const visualTransform = useItemVisualTransform()
  const sequence = useSequenceContext()
  const { fps } = useVideoConfig()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const viewportWidth = resolveViewportEdge(item.viewport?.width, DEFAULT_VIEWPORT_WIDTH)
  const viewportHeight = resolveViewportEdge(item.viewport?.height, DEFAULT_VIEWPORT_HEIGHT)
  const renderedWidth = (visualTransform?.width ?? viewportWidth) * (compositionSpace?.scaleX ?? 1)
  const renderedHeight =
    (visualTransform?.height ?? viewportHeight) * (compositionSpace?.scaleY ?? 1)
  const sourceDocument = useMemo(
    () => buildSourceDocument(item.html, item.css, viewportWidth, viewportHeight),
    [item.css, item.html, viewportHeight, viewportWidth],
  )
  const timeMs = item.renderMode === 'animated'
    ? Math.max(0, ((sequence?.localFrame ?? 0) / fps) * 1_000)
    : 0

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'luna-html-seek', timeMs }, '*')
  }, [timeMs])

  return (
    <div
      data-html-item={item.id}
      data-render-mode={item.renderMode}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'transparent',
        pointerEvents: 'none',
      }}
    >
      <iframe
        ref={iframeRef}
        title={item.label || 'HTML content'}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={sourceDocument}
        tabIndex={-1}
        aria-hidden="true"
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage({ type: 'luna-html-seek', timeMs }, '*')
        }}
        style={{
          display: 'block',
          width: viewportWidth,
          height: viewportHeight,
          border: 0,
          background: 'transparent',
          pointerEvents: 'none',
          transform: `scale(${renderedWidth / viewportWidth}, ${renderedHeight / viewportHeight})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  )
}
