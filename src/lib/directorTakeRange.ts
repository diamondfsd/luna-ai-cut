import type { DirectorLanPlanSummary, DirectorLanTake } from '../shared/types/directorLab.ts'

export type DirectorTakeRange = DirectorLanTake['selected_range']

export function validateDirectorTakeRange(range: DirectorTakeRange, durationMs?: number | null): DirectorTakeRange {
  if (range === null) return null
  if (!range || !Number.isSafeInteger(range.start_ms) || !Number.isSafeInteger(range.end_ms)
    || range.start_ms < 0 || range.end_ms <= range.start_ms
    || (typeof durationMs === 'number' && durationMs > 0 && range.end_ms > durationMs)
    || (range.note !== undefined && (typeof range.note !== 'string' || range.note.length > 4000))) {
    throw new Error('片段范围无效')
  }
  const note = range.note?.trim()
  return { start_ms: range.start_ms, end_ms: range.end_ms, ...(note ? { note } : {}) }
}

export function directorPlanWithTakeRange(plan: DirectorLanPlanSummary, takeId: string, range: DirectorTakeRange): DirectorLanPlanSummary {
  let found = false
  const shots = plan.shots.map(shot => ({ ...shot, takes: shot.takes.map(take => {
    if (take.id !== takeId) return take
    if (take.kind !== 'video') throw new Error('只能为视频标记片段')
    found = true
    return { ...take, selected_range: validateDirectorTakeRange(range, take.duration_ms) }
  }) }))
  if (!found) throw new Error('素材不属于当前计划')
  return { ...plan, shots }
}

export function assertDirectorTakeRangesSaved(requested: DirectorLanPlanSummary, saved: DirectorLanPlanSummary): void {
  const savedTakes = new Map(saved.shots.flatMap(shot => shot.takes).map(take => [take.id, take]))
  for (const take of requested.shots.flatMap(shot => shot.takes)) {
    if (take.kind !== 'video' || requested.pending_take_ids?.includes(take.id)) continue
    const actual = savedTakes.get(take.id)
    if (!actual || JSON.stringify(validateDirectorTakeRange(actual.selected_range)) !== JSON.stringify(validateDirectorTakeRange(take.selected_range))) {
      throw new Error('手机未保存片段标记，请更新手机端后重试')
    }
  }
}
