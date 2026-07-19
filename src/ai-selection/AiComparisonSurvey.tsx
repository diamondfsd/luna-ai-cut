import { Check, Sparkles } from 'lucide-react'

import type { AiSelectionItem } from '../shared/types'
import { Button } from '../ui'
import { AiMediaThumb } from './AiMediaThumb'

interface AiComparisonSurveyProps {
  items: AiSelectionItem[]
  representativeId: string
  focusedId: string | null
  onFocus: (id: string) => void
  onToggle: (item: AiSelectionItem) => void
  onRepresentative: (id: string) => void
}

export function AiComparisonSurvey({ items, representativeId, focusedId, onFocus, onToggle, onRepresentative }: AiComparisonSurveyProps) {
  if (items.length < 2) return null
  return <section className="ai-selection-survey">
    <header><div><strong>从这一组中选出最满意的</strong><span>比较人物状态、动作和构图，AI 推荐只是起点</span></div><small>逗号 / 句号切换 · P 选择</small></header>
    <div className="ai-selection-survey-grid">{items.map((item) => {
      const representative = representativeId === item.id
      return <article key={item.id} className={focusedId === item.id ? 'active' : ''} onClick={() => onFocus(item.id)}>
        <div className="ai-selection-survey-preview"><AiMediaThumb item={item} />{item.personEvidence?.bounds && <span className="ai-selection-person-box" style={{ left: `${item.personEvidence.bounds.x * 100}%`, top: `${item.personEvidence.bounds.y * 100}%`, width: `${item.personEvidence.bounds.width * 100}%`, height: `${item.personEvidence.bounds.height * 100}%` }} />}{item.personEvidence?.primaryFaceBounds && <span className="ai-selection-face-box" style={{ left: `${item.personEvidence.primaryFaceBounds.x * 100}%`, top: `${item.personEvidence.primaryFaceBounds.y * 100}%`, width: `${item.personEvidence.primaryFaceBounds.width * 100}%`, height: `${item.personEvidence.primaryFaceBounds.height * 100}%` }} />}</div>
        <div className="ai-selection-survey-meta"><span title={item.name}>{item.name}</span><small>{item.personEvidence?.detected ? `${item.personEvidence.faceCount ? `${item.personEvidence.faceCount} 张人脸 · ` : ''}${item.personEvidence.eyeState === 'open' ? '人物睁眼' : item.personEvidence.eyeState === 'closed' ? '可能闭眼' : item.personEvidence.eyeState === 'mixed' ? '人物状态需确认' : '已找到人物'}` : item.recommendationReason ?? '等待比较'}</small></div>
        <div className="ai-selection-survey-actions">
          <Button variant={item.selected ? 'primary' : 'secondary'} size="mini" icon={item.selected ? <Check size={12} /> : undefined} onClick={(event) => { event.stopPropagation(); onToggle(item) }}>{item.selected ? '已选择' : '选择'}</Button>
          {!representative && <Button variant="ghost" size="mini" icon={<Sparkles size={12} />} onClick={(event) => { event.stopPropagation(); onRepresentative(item.id) }}>设为推荐</Button>}
          {representative && <span><Sparkles size={12} />AI推荐</span>}
        </div>
      </article>
    })}</div>
  </section>
}
