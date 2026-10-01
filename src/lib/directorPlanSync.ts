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

export function directorPlanHasSameShots(remote: DirectorLanPlanSummary, local: DirectorLanPlanSummary): boolean {
  return remote.shots.length === local.shots.length
    && remote.shots.every((shot) => local.shots.some((item) => item.id === shot.id))
}

export function directorPlanConflictDetails(remote: DirectorLanPlanSummary, local: DirectorLanPlanSummary) {
  const differences: Array<{ label: string; remote: string; local: string }> = []
  function compare(label: string, remoteValue: string, localValue: string) {
    if (remoteValue !== localValue) differences.push({ label, remote: remoteValue, local: localValue })
  }
  compare('计划名称', remote.title, local.title)
  compare('计划属性', remote.attributes.map((field) => field.name).join('、'), local.attributes.map((field) => field.name).join('、'))
  const shotIds = new Set([...remote.shots, ...local.shots].map((shot) => shot.id))
  for (const shotId of shotIds) {
    const remoteShot = remote.shots.find((shot) => shot.id === shotId)
    const localShot = local.shots.find((shot) => shot.id === shotId)
    const name = remoteShot?.name ?? localShot?.name ?? ''
    if (!remoteShot || !localShot) {
      compare(name, remoteShot ? '镜头存在' : '镜头不存在', localShot ? '镜头存在' : '镜头不存在')
      continue
    }
    compare(`${name} · 顺序`, String(remoteShot.order), String(localShot.order))
    compare(`${name} · 名称`, remoteShot.name, localShot.name)
    compare(`${name} · 时长`, `${remoteShot.duration_ms / 1000} 秒`, `${localShot.duration_ms / 1000} 秒`)
    compare(`${name} · 备注`, remoteShot.remark, localShot.remark)
    const attributeIds = new Set([...remoteShot.attributes, ...localShot.attributes].map((field) => field.id))
    for (const attributeId of attributeIds) {
      const remoteField = remoteShot.attributes.find((field) => field.id === attributeId)
      const localField = localShot.attributes.find((field) => field.id === attributeId)
      compare(`${name} · ${remoteField?.name ?? localField?.name ?? ''}`,
        remoteField ? `${remoteField.name}：${remoteField.description}` : '',
        localField ? `${localField.name}：${localField.description}` : '')
    }
  }
  return differences
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
