import type { DirectorPlanAgentService } from '../features/director-lab/directorPlanAgentService.ts'
import { DirectorPlanAgentError } from '../features/director-lab/directorPlanAgentService.ts'
import type { AgentSessionManager } from './agentSessionManager.ts'
import type { AiEditorMcpResponse } from '../../src/shared/types/aiEditor.ts'
import { addAgentContext } from './lunaMcpProtocol.ts'

const string = { type: 'string', minLength: 1 }
const session = { sessionId: string, revision: { type: 'integer', minimum: 1 }, idempotencyKey: { ...string, maxLength: 120 } }
const target = { planId: string, expectedSnapshot: { type: 'string', minLength: 64, maxLength: 64 } }
const changes = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 }, mainContent: { type: 'string', maxLength: 4000 },
    appendMarkdown: { ...string, description: 'Full canonical Markdown with a title and new shots; adds server IDs without replacing existing shots.' },
    shotOrder: { type: 'array', items: string, maxItems: 500, description: 'Every current shotId exactly once. Read again after adding shots.' },
    shots: { type: 'array', maxItems: 500, items: {
      type: 'object', additionalProperties: false, required: ['shotId'], properties: {
        shotId: string, name: { type: 'string', minLength: 1, maxLength: 120 },
        durationMs: { type: 'integer', minimum: 1000, maximum: 3600000 },
        content: { type: 'string', maxLength: 4000 }, framing: { type: 'string', maxLength: 4000 },
        movement: { type: 'string', maxLength: 4000 }, remark: { type: 'string', maxLength: 4000 },
      },
    } },
  },
}
function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }
}

export const DIRECTOR_PLAN_TOOLS = [
  tool('get_director_plan_format', 'Read the fixed Markdown template, limits and local-only editing rules. No editor window or project required.'),
  tool('list_director_plans', 'List local plans with stable IDs and snapshots. Does not synchronize with a phone.', { limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } }),
  tool('get_director_plan', 'Read a local plan, stable shot IDs, material summaries and the snapshot required for edits. Filesystem paths are omitted.', { planId: string }, ['planId']),
  tool('validate_director_plan_markdown', 'Parse Markdown without saving. Check normalized content and warnings before creation.', { markdown: string, formatVersion: { type: 'integer', enum: [1] } }, ['markdown', 'formatVersion']),
  tool('create_director_plan', 'Create a local plan from Markdown in a claimed session. Reuse an idempotencyKey only for retries of identical content. No project, deletion or remote sync.',
    { ...session, markdown: string, formatVersion: { type: 'integer', enum: [1] } }, ['sessionId', 'revision', 'idempotencyKey', 'markdown', 'formatVersion']),
  tool('validate_director_plan_changes', 'Preview ID-preserving edits without saving. Supports fields, new shots and order; cannot remove shots or alter takes or timeline.',
    { ...target, changes }, ['planId', 'expectedSnapshot', 'changes']),
  tool('update_director_plan', 'Edit by stable shot IDs and expectedSnapshot; preserve takes, ranges and markers. Read again after adding shots. Only the latest write key is deduplicated across restarts; older writes are protected by snapshot.',
    { ...session, ...target, changes }, ['sessionId', 'revision', 'idempotencyKey', 'planId', 'expectedSnapshot', 'changes']),
]

const names = new Set(DIRECTOR_PLAN_TOOLS.map(item => item.name))
const writes = new Set(['create_director_plan', 'update_director_plan'])

export async function handleDirectorPlanTool(name: string, args: Record<string, unknown>, callId: string,
  service?: DirectorPlanAgentService, manager?: AgentSessionManager): Promise<AiEditorMcpResponse | null> {
  if (!names.has(name)) return null
  const started = Date.now()
  const guard = () => {
    if (!writes.has(name)) return
    const gate = manager?.gateActiveTool()
    if (!gate) throw new DirectorPlanAgentError('SESSION_REQUIRED', '请先领取或创建任务')
    if (!gate.allowed) throw new DirectorPlanAgentError(gate.error?.code ?? 'SESSION_NOT_ACTIVE', gate.error?.message ?? '任务不可用')
    if (gate.session.purpose === 'auto') throw new DirectorPlanAgentError('TASK_WORKFLOW_REQUIRED', '请先根据技能索引选择处理流程')
    if (args.sessionId !== gate.session.sessionId) throw new DirectorPlanAgentError('SESSION_NOT_FOUND', '任务编号无效')
    if (args.revision !== gate.session.revision) throw new DirectorPlanAgentError('REQUEST_UPDATED', '任务要求已更新，请重新读取')
  }
  try {
    if (!service) throw new DirectorPlanAgentError('UNSUPPORTED', '导演计划服务不可用')
    const schema = DIRECTOR_PLAN_TOOLS.find(item => item.name === name)!.inputSchema
    if (Object.keys(args).some(key => !Object.prototype.hasOwnProperty.call(schema.properties, key))
      || schema.required.some(key => !Object.prototype.hasOwnProperty.call(args, key))) {
      throw new DirectorPlanAgentError('INVALID_PARAMS', '计划操作参数无效')
    }
    guard()
    manager?.toolStarted(callId, name, args)
    const data = await service.execute(name, args, guard)
    const summary = name === 'create_director_plan' ? '计划已创建' : name === 'update_director_plan' ? '计划已更新' : '计划已读取'
    manager?.toolFinished(callId, name, args, true, summary, Date.now() - started)
    return { ok: true, result: addAgentContext({ ok: true, summary, data }, manager) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '计划操作失败'
    const failure = { code: error instanceof DirectorPlanAgentError ? error.code : 'PLAN_OPERATION_FAILED', message, retryable: false }
    manager?.toolFinished(callId, name, args, false, message, Date.now() - started, failure)
    return { ok: true, result: addAgentContext({ ok: false, summary: message, error: failure }, manager) }
  }
}
