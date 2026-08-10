import type { TextItem, TimelineItem } from '@freecut/types/timeline'
import type { AgentTextBox, AgentTextSpan, AgentTextStyle } from './types'

function transformForTextBox(
  box: AgentTextBox,
  canvas: { width: number; height: number },
): NonNullable<TextItem['transform']> {
  const width = box.width * canvas.width
  const height = box.height * canvas.height
  return {
    x: box.left * canvas.width + width / 2 - canvas.width / 2,
    y: box.top * canvas.height + height / 2 - canvas.height / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
  }
}

export function compileTextPresentation(params: {
  item: TextItem
  style?: AgentTextStyle
  spans?: AgentTextSpan[] | null
  box?: AgentTextBox
  canvas: { width: number; height: number }
}): Partial<TextItem> {
  const { item, style, spans, box, canvas } = params
  const updates: Partial<TextItem> = {
    ...(style ?? {}),
    ...(box ? { transform: { ...item.transform, ...transformForTextBox(box, canvas) } } : {}),
  }

  if (spans === null) {
    updates.textSpans = undefined
    updates.spanLayout = undefined
  } else if (spans) {
    updates.text = spans.map((span) => span.text).join('')
    updates.textSpans = spans.map((span) => ({ ...span }))
    updates.spanLayout = 'inline'
  }

  return updates
}

export function prepareEditableTextItem(
  item: TimelineItem,
): { item: TextItem; conversion: Partial<TimelineItem> } | null {
  if (item.type !== 'text') return null
  return { item, conversion: {} }
}

export function textBoxFromItem(
  item: TextItem,
  canvas: { width: number; height: number },
): AgentTextBox | undefined {
  const transform = item.transform
  if (!transform?.width || !transform.height) return undefined
  return {
    left: (canvas.width / 2 + (transform.x ?? 0) - transform.width / 2) / canvas.width,
    top: (canvas.height / 2 + (transform.y ?? 0) - transform.height / 2) / canvas.height,
    width: transform.width / canvas.width,
    height: transform.height / canvas.height,
  }
}
