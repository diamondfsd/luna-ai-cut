import type { DirectorLanPlanSummary } from '../shared/types'
import { normalizeDirectorShotFields } from './directorShotFields.ts'

export const DIRECTOR_PLAN_ATTRIBUTES = [
  { id: 'content', name: '画面内容' },
  { id: 'framing', name: '景别' },
  { id: 'movement', name: '运镜方式' },
]

export interface DirectorPlanSyncBaseline {
  revision: number
  remoteSignature: string
  localSignature: string
}

function stablePlanContent(plan: DirectorLanPlanSummary) {
  return {
    title: plan.title,
    ...(plan.main_content ? { mainContent: plan.main_content } : {}),
    attributes: (plan.attributes ?? DIRECTOR_PLAN_ATTRIBUTES).map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
    })),
    shots: plan.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      durationMs: shot.duration_ms,
      remark: shot.remark,
      ...(shot.takes.some(take => take.selected_range) ? { takeRanges: shot.takes.filter(take => take.selected_range).map(take => ({ id: take.id, selectedRange: take.selected_range })) } : {}),
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
  includeTakeRanges = true,
) {
  const shots = plan.shots.map((shot) => {
    const fields = normalizeDirectorShotFields(shot)
    if (fields.remark.length > 4000 || fields.attributes.some((field) => field.description.length > 4000 || field.id.length > 128)) {
      throw new Error('镜头内容超过手机接口限制（invalid-plan-update）')
    }
    return { id: shot.id, name: shot.name, duration_ms: shot.duration_ms, ...fields,
      ...(includeTakeRanges ? { take_ranges: shot.takes.filter(take => take.kind === 'video' && !plan.pending_take_ids?.includes(take.id)).map(take => ({ id: take.id, selected_range: take.selected_range })) } : {}),
    }
  })
  return {
    expected_revision: expectedRevision,
    title: plan.title,
    main_content: plan.main_content ?? '',
    attributes: plan.attributes,
    shots,
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

export function overlayDirectorLocalPlan(remote: DirectorLanPlanSummary, local: DirectorLanPlanSummary): DirectorLanPlanSummary {
  const dirty = local.pending_create || local.pending_shot_ids?.length
    || (local.synced_signature && directorPlanContentSignature(local) !== local.synced_signature)
  const base = dirty ? local : remote
  const shots = base.shots.map((shot) => {
    const localShot = local.shots.find((item) => item.id === shot.id)
    const remoteShot = remote.shots.find((item) => item.id === shot.id)
    const takes = [...remoteShot?.takes ?? []]
    for (const take of localShot?.takes ?? []) {
      const index = takes.findIndex((item) => item.id === take.id)
      if (index < 0 && local.pending_take_ids?.includes(take.id)) takes.push(take)
      else if (index >= 0) takes[index] = { ...takes[index], ...(take.available && take.stream_url ? take : {}),
        selected_range: dirty ? take.selected_range : takes[index].selected_range }
    }
    return { ...shot, takes, completed_takes: takes.filter((take) => take.available).length }
  })
  return { ...base, shots, source: local.pending_create ? 'local' : 'remote',
    local_directory: local.local_directory, pending_create: local.pending_create,
    local_updated_at: local.updated_at,
    local_content_signature: local.local_content_signature ?? directorPlanContentSignature(local),
    pending_shot_ids: local.pending_shot_ids, pending_take_ids: local.pending_take_ids,
    synced_revision: local.synced_revision, synced_signature: local.synced_signature,
    remote_plan: remote, shot_count: shots.length,
    take_count: shots.reduce((total, shot) => total + shot.takes.length, 0) }
}
