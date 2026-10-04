import type { DirectorLanPlanSummary } from '../../../src/shared/types'
import type { DirectorEditPlan } from './directorEditPlanValidation.ts'
import { directorPlanContentSignature } from '../../../src/lib/directorPlanSync.ts'

/** Every unrepresented planned shot must be explicitly explained, including missing footage. */
export function directorEditCoverage(proposal: DirectorEditPlan, source: DirectorLanPlanSummary) {
  if (source.id !== proposal.planId || directorPlanContentSignature(source) !== proposal.planSignature) throw new Error('拍摄计划已更新，请重新读取')
  for (const segment of proposal.segments) {
    const shot = source.shots.find(item => item.id === segment.shotId)
    const take = shot?.takes.find(item => item.id === segment.takeId)
    if (!take?.available) throw new Error('素材归属或可用性已变化，请重新读取计划')
  }
  const represented = new Set(proposal.segments.map(segment => segment.shotId))
  const omitted = proposal.omittedShots ?? []
  if (!Array.isArray(omitted) || omitted.length > 500 || omitted.some(item => !item || typeof item.shotId !== 'string'
    || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 4000)
    || new Set(omitted.map(item => item.shotId)).size !== omitted.length) throw new Error('缺失镜头说明无效')
  const allIds = new Set(source.shots.map(shot => shot.id))
  if ([...represented].some(id => !allIds.has(id)) || omitted.some(item => !allIds.has(item.shotId) || represented.has(item.shotId))) throw new Error('镜头覆盖说明与方案不一致')
  const missing = source.shots.filter(shot => !represented.has(shot.id))
  if (missing.some(shot => !omitted.some(item => item.shotId === shot.id))) throw new Error('请说明未选用镜头的原因')
  return { plannedShots: source.shots.length, representedShots: represented.size,
    omittedShots: missing.map(shot => ({ shotId: shot.id, name: shot.name,
      hasAvailableFootage: shot.takes.some(take => take.available), reason: omitted.find(item => item.shotId === shot.id)!.reason })),
  }
}
