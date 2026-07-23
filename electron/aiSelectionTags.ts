import type { AiSelectionItem } from '../src/shared/types'

type TaggableItem = Pick<AiSelectionItem, 'kind' | 'capturedAt' | 'width' | 'height' | 'duration' | 'quality' | 'personEvidence' | 'error'>

export function deriveBasicSemanticTags(item: TaggableItem): string[] {
  const tags = [item.kind === 'image' ? '照片' : '视频']
  if (item.width && item.height) tags.push(item.height > item.width ? '竖屏' : item.width > item.height ? '横屏' : '方形')

  const captured = new Date(item.capturedAt)
  if (!Number.isNaN(captured.getTime())) {
    const hour = captured.getHours()
    tags.push(hour >= 19 || hour < 6 ? '夜景' : '白天')
  }
  if (item.quality?.luminanceMean != null && item.quality.luminanceMean < 72) tags.push('低光')
  if (item.quality?.reasons.some((reason) => reason.includes('模糊') || reason.includes('清晰度'))) tags.push('模糊')
  if (item.quality?.grade === 'review' || item.error) tags.push('建议复查')
  if (item.kind === 'video' && item.duration != null && item.duration <= 15) tags.push('短视频')

  if (item.personEvidence?.detected) {
    tags.push('人物', '人像')
    if (item.personEvidence.faceCount > 1) tags.push('多人')
    else if (item.personEvidence.faceCount === 1) tags.push('单人')
    if (item.personEvidence.eyeState === 'closed') tags.push('闭眼')
    if (item.personEvidence.faceVisibility === 'occluded') tags.push('面部遮挡')
  }
  return [...new Set(tags)]
}

export function refreshBasicSemanticTags(item: AiSelectionItem): void {
  item.semanticTags = [...new Set([...deriveBasicSemanticTags(item), ...(item.semanticTags ?? [])])]
}
