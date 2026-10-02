import { ArrowRight, Film } from 'lucide-react'

import { DirectorPlanDeleteControl } from './DirectorPlanDeleteControl'
import type { DirectorLanPlanSummary } from '../shared/types'
import '../styles/director-lab-plan-list.css'

interface DirectorLabPlanListProps {
  plans: DirectorLanPlanSummary[]
  onDeleted: (plan: DirectorLanPlanSummary) => void
  deletingDisabled?: boolean
  onSelect: (planId: string) => void
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function DirectorLabPlanList({ plans, onSelect, onDeleted, deletingDisabled }: DirectorLabPlanListProps) {
  return (
    <section className="lab-plan-shell lab-plan-list-shell">
      <header className="lab-plan-list-header">
        <div>
          <strong>全部计划</strong>
          <span>{plans.length} 个计划</span>
        </div>
      </header>
      <div className="lab-plan-list">
        {plans.map((plan) => {
          const availableShots = plan.shots.filter((shot) =>
            shot.takes.some((take) => take.available)).length
          return (
            <div key={plan.id} className="lab-plan-list-row">
            <button
              className="lab-plan-list-item"
              type="button"
              onClick={() => onSelect(plan.id)}
            >
              <span className="lab-plan-list-icon"><Film size={18} /></span>
              <span className="lab-plan-list-copy">
                <strong>{plan.title}</strong>
                <small>更新于 {formatUpdatedAt(plan.updated_at)}</small>
              </span>
              <span className="lab-plan-list-progress">
                <strong>{availableShots}/{plan.shot_count}</strong>
                <small>已有素材</small>
              </span>
              <span className="lab-plan-list-meta">
                <span>{plan.take_count} 段素材</span>
                {plan.local_directory && <span>本地副本</span>}
                {plan.update_available && <span>副本待更新</span>}
              </span>
              <ArrowRight size={16} />
            </button>
            <DirectorPlanDeleteControl plan={plan} onDeleted={onDeleted} disabled={deletingDisabled} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
