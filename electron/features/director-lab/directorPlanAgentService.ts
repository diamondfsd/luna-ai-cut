import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DirectorLanPlanSummary } from '../../../src/shared/types/directorLab.ts'
import { parseDirectorPlanImport } from '../../../src/lib/directorPlanImport.ts'
import { applyDirectorLocalPlanEdit } from '../../../src/lib/directorPlanLocalEdit.ts'
import { appendDirectorLocalShots } from '../../../src/lib/directorLocalShots.ts'
import { directorPlanContentSignature } from '../../../src/lib/directorPlanSync.ts'
import { createDirectorPlanWriter } from './directorLabPlanWriter.ts'
import { listLocalDirectorPlans } from './directorLabPlanReader.ts'
import { mediaFolder, mediaFileName } from './directorLabPlanStorage.ts'

export class DirectorPlanAgentError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

export const DIRECTOR_PLAN_FORMAT = {
  formatVersion: 1,
  template: '# 计划名称\n主要内容：主题与成片要求\n\n## 01 镜头名称\n画面说明：主体与动作\n景别：中景\n运镜说明：固定机位\n建议时长：5 秒\n备注：拍摄或剪辑注意事项\n',
  limits: { utf8Bytes: 512 * 1024, shots: 500, nameCharacters: 120, fieldCharacters: 4000, minDurationMs: 1000, maxDurationMs: 3600000 },
  notes: ['Markdown 创建新计划和镜头，不保留旧镜头编号。', '编辑已有镜头使用 shotId；素材和标记保持不变。', '未知字段保存为备注，不成为剪辑限制。', '本接口只操作本地计划，不同步手机或修改剪辑项目。'],
}

function fail(code: string, message: string): never { throw new DirectorPlanAgentError(code, message) }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('INVALID_PARAMS', `${label}无效`)
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PARAMS', '计划参数无效')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_PARAMS', '包含不支持的计划字段')
}

export function directorAgentSnapshot(plan: DirectorLanPlanSummary): string {
  return hash(JSON.stringify({ content: directorPlanContentSignature(plan), takes: plan.shots.map(shot => [shot.id, shot.takes.map(take => take.id)]) }))
}

function publicPlan(plan: DirectorLanPlanSummary) {
  return {
    planId: plan.id, snapshot: directorAgentSnapshot(plan), title: plan.title, mainContent: plan.main_content ?? '',
    updatedAt: plan.updated_at, pendingSync: plan.pending_create === true || (plan.synced_signature !== undefined && plan.synced_signature !== directorPlanContentSignature(plan)),
    shots: plan.shots.map(shot => ({ shotId: shot.id, order: shot.order, name: shot.name, durationMs: shot.duration_ms,
      attributes: shot.attributes.map(field => ({ name: field.name, description: field.description })), remark: shot.remark,
      takes: shot.takes.map(take => ({ takeId: take.id, name: take.file_name, kind: take.kind, available: take.available,
        durationMs: take.duration_ms ?? null, selectedRange: take.selected_range, markers: take.markers ?? [] })) })),
  }
}

export function validateDirectorAgentMarkdown(markdown: unknown, formatVersion: unknown) {
  if (formatVersion !== 1) fail('UNSUPPORTED_FORMAT', '计划格式版本不支持')
  const source = text(markdown, '计划文本', 512 * 1024)
  if (Buffer.byteLength(source, 'utf8') > 512 * 1024) fail('INVALID_PARAMS', '计划文本不能超过 512 KB')
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim())
  if (!lines[0]?.startsWith('# ') || !lines[0].slice(2).trim() || lines.filter(line => /^# /.test(line)).length !== 1
    || lines.some(line => /^\s*```|^\s*\||^\s*[-*+]\s/.test(line))
    || !lines.some(line => /^## /.test(line))) fail('INVALID_MARKDOWN', '请使用导演计划格式')
  let shotStarted = false
  let mainStarted = false
  let fields = new Set<string>()
  const warnings: string[] = []
  for (const line of lines.slice(1)) {
    if (/^##\s+\S/.test(line)) {
      if (shotStarted && !fields.has('建议时长')) warnings.push('部分镜头未明确填写建议时长，请检查解析结果')
      shotStarted = true
      fields = new Set()
      continue
    }
    if (/^#/.test(line)) fail('INVALID_MARKDOWN', '计划标题或镜头格式无效')
    if (!shotStarted) {
      if (/^主要内容[：:]/.test(line)) mainStarted = true
      else if (!mainStarted) fail('INVALID_MARKDOWN', '计划标题或镜头格式无效')
    }
    const field = /^([^:：]+)[：:]\s*(.*)$/.exec(line.trim())
    if (field && shotStarted) {
      if (fields.has(field[1])) warnings.push(`字段“${field[1]}”重复，请检查解析结果`)
      fields.add(field[1])
      if (!['画面说明', '景别', '运镜说明', '建议时长', '备注'].includes(field[1])) warnings.push(`字段“${field[1]}”将按现有导入规则处理`)
      if (field[1] === '建议时长') {
        const duration = /^(\d+(?:\.\d+)?)\s*秒$/.exec(field[2])
        if (!duration || Number(duration[1]) < 1 || Number(duration[1]) > 3600) warnings.push('建议时长可能采用默认值或被调整，请检查解析结果')
      }
    }
  }
  let counter = 0
  let plan: DirectorLanPlanSummary
  try { plan = parseDirectorPlanImport(source, '导演计划', () => `draft-${++counter}`) }
  catch (error) { fail('INVALID_MARKDOWN', error instanceof Error ? error.message : '计划格式无效') }
  if ((plan.main_content?.length ?? 0) > 4000) fail('INVALID_PARAMS', '主要内容不能超过 4000 字')
  if (!fields.has('建议时长')) warnings.push('部分镜头未明确填写建议时长，请检查解析结果')
  return { formatVersion: 1, draft: { title: plan.title, mainContent: plan.main_content ?? '',
    shots: plan.shots.map(shot => ({ name: shot.name, durationMs: shot.duration_ms, attributes: shot.attributes, remark: shot.remark })) },
  totalDurationMs: plan.shots.reduce((total, shot) => total + shot.duration_ms, 0), warnings: [...new Set(warnings)] }
}

function applyChanges(current: DirectorLanPlanSummary, changes: unknown): DirectorLanPlanSummary {
  const request = object(changes)
  keys(request, ['title', 'mainContent', 'shots', 'appendMarkdown', 'shotOrder'])
  if (!Object.keys(request).length) fail('INVALID_PARAMS', '计划修改不能为空')
  let proposed = structuredClone(current)
  if (request.title !== undefined) proposed.title = text(request.title, '计划名称', 120).trim()
  if (request.mainContent !== undefined) proposed.main_content = text(request.mainContent, '主要内容', 4000, true)
  if (request.shots !== undefined) {
    if (!Array.isArray(request.shots) || request.shots.length > 500) fail('INVALID_PARAMS', '镜头修改无效')
    const seen = new Set<string>()
    for (const value of request.shots) {
      const patch = object(value)
      keys(patch, ['shotId', 'name', 'durationMs', 'content', 'framing', 'movement', 'remark'])
      const id = text(patch.shotId, '镜头编号', 120)
      if (seen.has(id)) fail('INVALID_PARAMS', '镜头编号重复')
      seen.add(id)
      const shot = proposed.shots.find(item => item.id === id)
      if (!shot) fail('SHOT_NOT_FOUND', '镜头不存在')
      if (patch.name !== undefined) shot.name = text(patch.name, '镜头名称', 120).trim()
      if (patch.remark !== undefined) shot.remark = text(patch.remark, '镜头备注', 4000, true)
      if (patch.durationMs !== undefined) {
        if (!Number.isSafeInteger(patch.durationMs) || Number(patch.durationMs) < 1000 || Number(patch.durationMs) > 3600000) fail('INVALID_PARAMS', '镜头时长无效')
        shot.duration_ms = Number(patch.durationMs)
      }
      for (const [key, names] of Object.entries({ content: ['画面内容', '画面说明'], framing: ['景别'], movement: ['运镜方式', '运镜说明'] })) {
        if (patch[key] === undefined) continue
        const description = text(patch[key], '镜头内容', 4000, true)
        const existing = shot.attributes.find(field => names.includes(field.name))
        if (existing) existing.description = description
        else shot.attributes.push({ id: `${id}-attribute-${key}`, name: names[0], description })
      }
    }
  }
  if (request.appendMarkdown !== undefined) {
    validateDirectorAgentMarkdown(request.appendMarkdown, 1)
    const additions = parseDirectorPlanImport(request.appendMarkdown as string, current.title, randomUUID).shots
    proposed = appendDirectorLocalShots(proposed, additions)
  }
  if (request.shotOrder !== undefined) {
    if (!Array.isArray(request.shotOrder) || request.shotOrder.length !== proposed.shots.length
      || request.shotOrder.some(id => typeof id !== 'string') || new Set(request.shotOrder).size !== proposed.shots.length) fail('INVALID_PARAMS', '镜头顺序必须包含全部镜头编号')
    const byId = new Map(proposed.shots.map(shot => [shot.id, shot]))
    proposed.shots = request.shotOrder.map(id => { const shot = byId.get(id); if (!shot) fail('SHOT_NOT_FOUND', '镜头不存在'); return shot })
  }
  const edited = applyDirectorLocalPlanEdit(current, proposed, directorPlanContentSignature(current))
  // The UI editor intentionally treats unmatched IDs as empty takes; new Agent additions are server-created here.
  edited.pending_shot_ids = proposed.pending_shot_ids
  // Existing file layout uses order/name, not shotId. Reject swaps that would reuse another take's path.
  if (current.local_directory) {
    const normalize = (value: string) => process.platform === 'linux' ? path.resolve(value) : path.resolve(value).toLowerCase()
    const sourceOwners = new Map(current.shots.flatMap(shot => shot.takes.flatMap(take =>
      take.available && take.stream_url?.startsWith('file:') ? [[normalize(fileURLToPath(take.stream_url)), take.id] as const] : [])))
    for (const shot of edited.shots) for (const [index, take] of shot.takes.entries()) {
      const target = normalize(path.join(current.local_directory, mediaFolder(shot.order, shot.name), mediaFileName(index + 1, take.file_name)))
      const owner = sourceOwners.get(target)
      if (owner && owner !== take.id) fail('PLAN_MEDIA_COLLISION', '镜头目录重名，请先调整镜头名称')
    }
  }
  return edited
}

export function createDirectorPlanAgentService(getRoot: () => Promise<string>) {
  const listPlans = async () => listLocalDirectorPlans(await getRoot())
  const save = createDirectorPlanWriter(listPlans, getRoot)
  const get = async (id: unknown) => {
    const planId = text(id, '计划编号', 120)
    const plan = (await listPlans()).find(item => item.id === planId)
    if (!plan) fail('PLAN_NOT_FOUND', '本地计划不存在')
    return plan
  }
  const check = (current: DirectorLanPlanSummary, expected: unknown) => {
    if (text(expected, '计划版本', 64) !== directorAgentSnapshot(current)) fail('PLAN_VERSION_CONFLICT', '计划已更新，请重新读取')
  }
  const receipt = (args: Record<string, unknown>) => ({ keyHash: hash(text(args.idempotencyKey, '操作编号', 120)),
    inputHash: hash(JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => !['sessionId', 'revision'].includes(key)).sort(([a], [b]) => a.localeCompare(b))))) })
  return {
    async execute(name: string, args: Record<string, unknown>, beforeCommit: () => void = () => {}) {
      if (name === 'get_director_plan_format') return DIRECTOR_PLAN_FORMAT
      if (name === 'validate_director_plan_markdown') return validateDirectorAgentMarkdown(args.markdown, args.formatVersion)
      if (name === 'list_director_plans') {
        const limit = args.limit ?? 20
        const offset = args.offset ?? 0
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) fail('INVALID_PARAMS', '查询数量无效')
        if (!Number.isSafeInteger(offset) || Number(offset) < 0) fail('INVALID_PARAMS', '查询位置无效')
        const plans = await listPlans()
        const end = Number(offset) + Number(limit)
        return { total: plans.length, nextOffset: end < plans.length ? end : null, plans: plans.slice(Number(offset), end).map(plan => ({ planId: plan.id, title: plan.title,
          snapshot: directorAgentSnapshot(plan), shotCount: plan.shots.length, takeCount: plan.take_count, updatedAt: plan.updated_at })) }
      }
      if (name === 'get_director_plan') return { plan: publicPlan(await get(args.planId)) }
      if (name === 'create_director_plan') {
        const validated = validateDirectorAgentMarkdown(args.markdown, args.formatVersion)
        const proof = receipt(args)
        const plan = parseDirectorPlanImport(args.markdown as string, '导演计划', randomUUID)
        plan.id = `plan-agent-${proof.keyHash.slice(0, 40)}`
        plan.agent_creation_receipt = proof
        let created = false
        const result = await save(plan, current => {
          if (current.local_directory) {
            if (current.agent_creation_receipt?.keyHash !== proof.keyHash || current.agent_creation_receipt?.inputHash !== proof.inputHash) fail('IDEMPOTENCY_CONFLICT', '操作编号已用于其他内容')
            return current
          }
          created = true
          return plan
        }, beforeCommit)
        return { plan: publicPlan(result), created, warnings: validated.warnings }
      }
      if (name === 'validate_director_plan_changes' || name === 'update_director_plan') {
        const existing = await get(args.planId)
        if (name === 'validate_director_plan_changes') {
          check(existing, args.expectedSnapshot)
          return { plan: publicPlan(applyChanges(existing, args.changes)), baseSnapshot: directorAgentSnapshot(existing), persisted: false }
        }
        const proof = receipt(args)
        let changed = false
        const result = await save(existing, current => {
          if (current.agent_write_receipt?.keyHash === proof.keyHash) {
            if (current.agent_write_receipt.inputHash !== proof.inputHash) fail('IDEMPOTENCY_CONFLICT', '操作编号已用于其他内容')
            return current
          }
          check(current, args.expectedSnapshot)
          const next = applyChanges(current, args.changes)
          next.agent_write_receipt = proof
          changed = true
          return next
        }, beforeCommit, true)
        return { plan: publicPlan(result), changed }
      }
      fail('UNKNOWN_TOOL', '计划操作不支持')
    },
  }
}

export type DirectorPlanAgentService = ReturnType<typeof createDirectorPlanAgentService>
