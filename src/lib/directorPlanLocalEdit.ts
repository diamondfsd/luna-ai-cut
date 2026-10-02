import type { DirectorLanPlanSummary } from '../shared/types/directorLab.ts'
import { directorPlanContentSignature } from './directorPlanSync.ts'
import { validateDirectorTakeRange } from './directorTakeRange.ts'
import { validateDirectorTakeMarkers } from './directorTakeMarkers.ts'

export function directorLocalEditHasConflict(current: DirectorLanPlanSummary,
  requested: DirectorLanPlanSummary, expectedSignature?: string): boolean {
  const currentSignature = directorPlanContentSignature(current)
  if (currentSignature === directorPlanContentSignature(requested)) return false
  const baseline = expectedSignature ?? requested.local_content_signature
  if (typeof baseline === 'string') return currentSignature !== baseline
  return (requested.revision ?? 0) !== (current.revision ?? 0)
    || (requested.local_updated_at ?? requested.updated_at) !== current.updated_at
}

export function applyDirectorLocalPlanEdit(current: DirectorLanPlanSummary, plan: DirectorLanPlanSummary,
  expectedSignature?: string): DirectorLanPlanSummary {
  if (directorLocalEditHasConflict(current, plan, expectedSignature)) throw new Error('计划已更新，请刷新后重试')
  if (!plan.title?.trim() || plan.title.length > 120 || plan.shots.length > 500
    || (plan.main_content !== undefined && typeof plan.main_content !== 'string')
    || new Set(plan.shots.map(shot => shot.id)).size !== plan.shots.length
    || plan.shots.some(shot => !shot.name.trim() || shot.name.length > 120 || shot.remark.length > 4000
      || !Number.isSafeInteger(shot.duration_ms) || shot.duration_ms < 1000 || shot.duration_ms > 3600000
      || shot.attributes.some(field => field.description.length > 4000))) throw new Error('计划内容无效')
  const requestedIds = new Set(plan.shots.map(shot => shot.id))
  const shots = plan.shots.map((shot, index) => ({ ...shot, order: index + 1,
    takes: (current.shots.find(item => item.id === shot.id)?.takes ?? []).map(take => {
      const requested = shot.takes?.find(item => item.id === take.id)
      return requested && take.kind === 'video'
        ? { ...take, selected_range: validateDirectorTakeRange(requested.selected_range, take.duration_ms),
          markers: requested.markers === undefined ? take.markers ?? [] : validateDirectorTakeMarkers(requested.markers, take.duration_ms) }
        : take
    }) }))
  return { ...current, title: plan.title, main_content: plan.main_content ?? current.main_content ?? '', shots,
    shot_count: shots.length, updated_at: new Date().toISOString(),
    pending_shot_ids: current.pending_shot_ids?.filter(id => requestedIds.has(id)),
    pending_take_ids: current.pending_take_ids?.filter(id => shots.some(shot => shot.takes.some(take => take.id === id))) }
}
