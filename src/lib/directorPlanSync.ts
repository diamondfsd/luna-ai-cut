import type { DirectorLanPlanSummary } from '../shared/types'

export interface DirectorPlanSyncBaseline {
  revision: number
  remoteSignature: string
  localSignature: string
}

function stablePlanContent(plan: DirectorLanPlanSummary) {
  return {
    title: plan.title,
    attributes: plan.attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
    })),
    shots: plan.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      durationMs: shot.duration_ms,
      remark: shot.remark,
      attributes: shot.attributes.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        description: attribute.description,
      })),
    })),
  }
}

export function directorPlanContentSignature(plan: DirectorLanPlanSummary): string {
  return JSON.stringify(stablePlanContent(plan))
}

export function directorPlanRevision(plan: DirectorLanPlanSummary): number {
  return Number.isSafeInteger(plan.revision) ? plan.revision ?? 0 : 0
}

export function buildDirectorPlanUpdate(
  plan: DirectorLanPlanSummary,
  expectedRevision: number,
) {
  return {
    expected_revision: expectedRevision,
    title: plan.title,
    attributes: plan.attributes,
    shots: plan.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      duration_ms: shot.duration_ms,
      remark: shot.remark,
      attributes: shot.attributes.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        description: attribute.description,
      })),
    })),
  }
}

export function nextDirectorPlanBaseline(
  remote: DirectorLanPlanSummary,
  local: DirectorLanPlanSummary,
): DirectorPlanSyncBaseline {
  return {
    revision: directorPlanRevision(remote),
    remoteSignature: directorPlanContentSignature(remote),
    localSignature: directorPlanContentSignature(local),
  }
}
