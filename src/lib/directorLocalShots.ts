import type { DirectorLanPlanSummary, DirectorLanShot } from '../shared/types/directorLab.ts'

export function appendDirectorLocalShots(current: DirectorLanPlanSummary, additions: DirectorLanShot[], now = new Date().toISOString()): DirectorLanPlanSummary {
  if (current.shots.length + additions.length > 500) throw new Error('最多支持 500 个镜头')
  const shots = [...current.shots, ...additions].map((shot, index) => ({ ...shot, order: index + 1 }))
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) throw new Error('镜头编号重复')
  return { ...current, shots, shot_count: shots.length, updated_at: now,
    pending_shot_ids: [...current.pending_shot_ids ?? [], ...additions.map((shot) => shot.id)] }
}
