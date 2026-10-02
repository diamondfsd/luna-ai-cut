import type { DirectorLanPlanSummary } from '../shared/types/directorLab.ts'
import { directorPlanContentSignature } from './directorPlanSync.ts'

export function directorLocalEditHasConflict(current: DirectorLanPlanSummary,
  requested: DirectorLanPlanSummary, expectedSignature?: string): boolean {
  const currentSignature = directorPlanContentSignature(current)
  if (currentSignature === directorPlanContentSignature(requested)) return false
  const baseline = expectedSignature ?? requested.local_content_signature
  if (typeof baseline === 'string') return currentSignature !== baseline
  return (requested.revision ?? 0) !== (current.revision ?? 0)
    || (requested.local_updated_at ?? requested.updated_at) !== current.updated_at
}
