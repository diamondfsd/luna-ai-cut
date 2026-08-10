import type { HtmlItem } from '@freecut/types/timeline'
import type { ItemRenderContext, ItemTransform } from './types'

function htmlRasterKey(item: HtmlItem): string {
  return JSON.stringify({
    id: item.id,
    revision: item.sourceRevision,
    html: item.html,
    css: item.css,
    viewport: item.viewport,
  })
}

export async function renderHtmlItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: HtmlItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
): Promise<void> {
  const provider = rctx.htmlFrameProvider
  if (!provider) return

  const staticKey = item.renderMode === 'static' ? htmlRasterKey(item) : null
  let source = staticKey ? rctx.htmlRasterCache?.get(staticKey) : undefined
  if (!source) {
    source = await provider({
      item,
      width: Math.max(1, Math.round(item.viewport.width)),
      height: Math.max(1, Math.round(item.viewport.height)),
      timeMs: Math.max(0, ((frame - item.from) / rctx.canvasSettings.fps) * 1_000),
    }) ?? undefined
    if (source && staticKey) rctx.htmlRasterCache?.set(staticKey, source)
  }
  if (!source) return

  const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2
  const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2
  try {
    ctx.drawImage(source, left, top, transform.width, transform.height)
  } finally {
    if (!staticKey) source.close()
  }
}
