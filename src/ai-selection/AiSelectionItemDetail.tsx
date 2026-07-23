import { CircleAlert, Expand, ScanSearch, Sparkles } from 'lucide-react'

import type { AiSelectionItem } from '../shared/types'
import { ThumbImage } from '../components/ThumbImage'

interface AiSelectionItemDetailProps {
  item: AiSelectionItem | null
  mode: 'analysis' | 'recommendation'
  onPreview: (item: AiSelectionItem) => void
}

function formatCapturedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function analysisReasons(item: AiSelectionItem, mode: AiSelectionItemDetailProps['mode']): string[] {
  const reasons = [
    item.error,
    item.recommendationReason,
    ...(item.quality?.reasons ?? []),
  ].filter((reason): reason is string => Boolean(reason))
  if (item.flags.closedEyes && !reasons.some((reason) => reason.includes('眼'))) reasons.push('检测到人物闭眼，需要确认')
  if (item.flags.analysisFailed && !reasons.some((reason) => reason.includes('失败'))) reasons.push('素材分析未完成，需要人工确认')
  if (mode === 'analysis' && reasons.length === 0) {
    reasons.push(item.quality?.grade === 'excellent' || item.quality?.grade === 'good'
      ? '画面清晰，曝光和细节表现良好'
      : '已完成画面质量分析')
  }
  return [...new Set(reasons)].slice(0, 4)
}

export function AiSelectionItemDetail({ item, mode, onPreview }: AiSelectionItemDetailProps) {
  const isRecommendation = mode === 'recommendation'
  const Icon = isRecommendation ? Sparkles : ScanSearch
  if (!item) return <aside className="ai-selection-item-detail" aria-live="polite">
    <div className="ai-selection-item-detail-empty">
      <Icon size={20} />
      <strong>{isRecommendation ? '选择一项推荐素材' : '选择一项素材'}</strong>
      <span>{isRecommendation ? '这里会显示 AI 推荐它的原因' : '这里会显示图片分析结果'}</span>
    </div>
  </aside>

  const reasons = analysisReasons(item, mode)
  const needsAttention = item.flags.lowQuality || item.flags.closedEyes || item.flags.analysisFailed
  const contentTags = [...new Set(item.contentTags)].slice(0, 6)

  return <aside className="ai-selection-item-detail" aria-live="polite">
    <button className="ai-selection-detail-preview" type="button" aria-label={`查看 ${item.name} 详情`} onClick={() => onPreview(item)}>
      <ThumbImage src={item.thumbnailUrl ?? item.videoKeyframes[0]?.thumbnailUrl ?? item.path} alt={item.name} />
      <span className="ai-selection-preview-hint"><Expand size={15} /></span>
    </button>
    <h3 title={item.name}>{item.name}</h3>
    <div className={`ai-selection-item-reasons${needsAttention ? ' review' : ''}`}>
      <strong>{needsAttention ? <CircleAlert size={14} /> : <Icon size={14} />}{isRecommendation ? '推荐原因' : needsAttention ? '需要注意' : '分析结果'}</strong>
      <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>
    <dl className="ai-selection-item-meta">
      <div><dt>拍摄时间</dt><dd>{formatCapturedAt(item.capturedAt)}</dd></div>
      <div><dt>素材类型</dt><dd>{item.kind === 'video' ? '视频' : '照片'}</dd></div>
      {contentTags.length > 0 && <div><dt>识别内容</dt><dd>{contentTags.join('、')}</dd></div>}
    </dl>
  </aside>
}
