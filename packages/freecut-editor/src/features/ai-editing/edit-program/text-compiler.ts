import type { TextItem, TimelineItem } from '@freecut/types/timeline'
import type { AgentTextBox, AgentTextSpan, AgentTextStyle } from './types'
import {
  normalizedTextBoxFromTransform,
  transformFromNormalizedTextBox,
} from '@freecut/features/project-source/normalized-text-layout'

function transformForTextBox(
  box: AgentTextBox,
  canvas: { width: number; height: number },
): NonNullable<TextItem['transform']> {
  return {
    ...transformFromNormalizedTextBox(box, canvas),
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
  return normalizedTextBoxFromTransform(item.transform, canvas)
}
