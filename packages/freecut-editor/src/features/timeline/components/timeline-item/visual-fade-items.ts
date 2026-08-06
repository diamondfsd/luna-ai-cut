import type { TimelineItem } from '@freecut/types/timeline'

export function supportsVisualFadeControls(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'composition'
}
