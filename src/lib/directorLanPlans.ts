import type { DirectorLanPlanAttribute, DirectorLanPlanSummary, DirectorPlanSchema, DirectorLanPlansResponse, DirectorLanShot } from '../shared/types'
import { DIRECTOR_PLAN_ATTRIBUTES } from '../lib/directorPlanSync'

export function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('请输入手机地址')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP 地址')
  if (!url.port) url.port = '47821'
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export async function requestPlans(endpoint: string): Promise<DirectorLanPlansResponse> {
  const payload = await window.luna.lunaKaHttpClient.request<DirectorLanPlansResponse>(
    endpoint,
    '/api/v1/director/plans',
  )
  if (payload.service !== 'luna-ka-director' || !Array.isArray(payload.plans)) {
    throw new Error('手机返回的数据格式不兼容')
  }
  return normalizePlanUrls(payload, endpoint)
}

export async function requestSchema(endpoint: string): Promise<DirectorPlanSchema> {
  const schema = await window.luna.lunaKaHttpClient.request<DirectorPlanSchema>(
    endpoint,
    '/api/v1/director/schema',
  )
  if (!Number.isSafeInteger(schema.schema_version) || schema.schema_version < 1
    || !Array.isArray(schema.shot_fields) || schema.shot_fields.length > 100
    || new Set(schema.shot_fields.map((field) => field.id)).size !== schema.shot_fields.length
    || schema.shot_fields.some((field) =>
      !/^[a-z][a-z0-9_]*$/.test(field.id)
      || !field.label?.trim()
      || !field.storage_name?.trim()
      || field.storage_name.length > 80
      || !['text', 'multiline'].includes(field.kind)
      || !Number.isSafeInteger(field.max_length)
      || field.max_length < 1 || field.max_length > 4000)) {
    throw new Error('手机返回的导演计划字段定义无效')
  }
  return schema
}

function normalizeServiceUrl(endpoint: string, value: string | null): string | null {
  if (!value) return null
  try {
    const target = new URL(endpoint)
    const resolved = new URL(value, target)
    // Older phone builds omitted the HTTP port in absolute URLs. Keep the
    // actual connected origin so playback and downloads never fall back to :80.
    resolved.protocol = target.protocol
    resolved.hostname = target.hostname
    resolved.port = target.port
    return resolved.toString()
  } catch {
    return value
  }
}

function normalizePlanUrls(
  payload: DirectorLanPlansResponse,
  endpoint: string,
): DirectorLanPlansResponse {
  return {
    ...payload,
    plans: payload.plans
      .map((plan) => normalizeRemotePlan(plan, endpoint))
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
  }
}

function normalizePlanAttributeDefinitions(
  plan: DirectorLanPlanSummary,
): DirectorLanPlanAttribute[] {
  const candidate = plan as DirectorLanPlanSummary & { attribute_definitions?: unknown }
  const rawDefinitions = Array.isArray(candidate.attributes)
    ? candidate.attributes
    : Array.isArray(candidate.attribute_definitions)
      ? candidate.attribute_definitions
      : []
  const definitions = rawDefinitions
    .filter((attribute): attribute is { id?: unknown; name: unknown } =>
      !!attribute
      && typeof attribute === 'object'
      && typeof attribute.name === 'string'
      && attribute.name.trim().length > 0)
    .map((attribute, index) => ({
      id: typeof attribute.id === 'string' && attribute.id
        ? attribute.id
        : `${plan.id}-attribute-${index}`,
      name: (attribute.name as string).trim(),
    }))
  if (definitions.length > 0) return definitions

  return DIRECTOR_PLAN_ATTRIBUTES.map((attribute) => ({ ...attribute }))
}

function legacyShotDescriptions(shot: DirectorLanShot): Map<string, string> {
  const descriptions = new Map<string, string>()
  if (Array.isArray(shot.attributes)) {
    for (const attribute of shot.attributes) {
      if (attribute.name?.trim()) {
        descriptions.set(attribute.name.trim(), attribute.description?.trim() ?? '')
        if (attribute.id) descriptions.set(attribute.id, attribute.description?.trim() ?? '')
      }
    }
  }
  const legacy: Array<{ name: string; description?: string }> = [
    { name: '画面说明', description: shot.visual_description },
    { name: '运镜说明', description: shot.movement_description },
  ]
  for (const attribute of legacy) {
    if (attribute.description?.trim() && !descriptions.has(attribute.name)) {
      descriptions.set(attribute.name, attribute.description.trim())
    }
  }
  return descriptions
}

function normalizeRemotePlan(
  plan: DirectorLanPlanSummary,
  endpoint: string,
): DirectorLanPlanSummary {
  const attributes = normalizePlanAttributeDefinitions(plan)
  return {
    ...plan,
    source: 'remote' as const,
    attributes,
    archive_url: normalizeServiceUrl(endpoint, plan.archive_url) ?? plan.archive_url,
    shots: plan.shots.map((shot) => {
      const descriptions = legacyShotDescriptions(shot)
      return {
        ...shot,
        attributes: Array.isArray(shot.attributes) && shot.attributes.length > 0
          ? shot.attributes
          : attributes.map((attribute) => ({
              id: attribute.id,
              name: attribute.name,
              description: descriptions.get(attribute.id) ?? descriptions.get(attribute.name) ?? '',
            })),
        remark: typeof shot.remark === 'string' ? shot.remark : '',
        takes: shot.takes.map((take) => ({
          ...take,
          stream_url: normalizeServiceUrl(endpoint, take.stream_url),
          download_url: normalizeServiceUrl(endpoint, take.download_url),
        })),
      }
    }),
  }
}
