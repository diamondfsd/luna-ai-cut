import type { TimelineItem } from '@freecut/types/timeline'

export function assertSingleShotInsert(items: readonly Pick<TimelineItem, 'type'>[]): void {
  const primaryVisualCount = items.filter(
    (item) => item.type === 'video' || item.type === 'image',
  ).length
  if (primaryVisualCount <= 1) return
  throw new Error(
    `一次编辑程序只能新增一个主画面 shot；本次包含 ${primaryVisualCount} 个。请先提交最早的一个 shot，再基于最新版本继续。`,
  )
}
