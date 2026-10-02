import type { LunaToolModule } from '../../mcp/lunaToolModule.ts'
import { AgentSessionError } from '../../mcp/agentSessionManager.ts'

/** Workflow selection is an Agent decision, gated by the claimed request revision. */
export const agentWorkflowModule: LunaToolModule = {
  id: 'agent-workflows',
  tools: [{
    name: 'select_task_workflow',
    description: 'After list_agent_skills/get_agent_skill, select the workflow declared by the matching skill. Requires the claimed session and current revision. Plan-only requests use director-plan; video editing or combined plan-and-video requests use editing. Ask in the external conversation if unclear. Never switch an already chosen workflow.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { sessionId: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 1 },
        workflow: { type: 'string', enum: ['editing', 'director-plan'] } },
      required: ['sessionId', 'revision', 'workflow'],
    },
  }, {
    name: 'update_task_request',
    description: 'Record a new user instruction or clarification from the current external conversation, verbatim. Requires the claimed session and current revision. Never rewrite the request on behalf of the user. Preserves the first archived message. Read get_edit_request after success to acknowledge the new revision.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { sessionId: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 1 },
        request: { type: 'string', minLength: 1, maxLength: 6000 } }, required: ['sessionId', 'revision', 'request'],
    },
  }],
  async execute(name, args, context) {
    if (!['select_task_workflow', 'update_task_request'].includes(name)) return null
    try {
      if (name === 'update_task_request') {
        if (Object.keys(args).some(key => !['sessionId', 'revision', 'request'].includes(key))
          || typeof args.sessionId !== 'string' || !args.sessionId || !Number.isInteger(args.revision)
          || Number(args.revision) < 1 || typeof args.request !== 'string' || !args.request.trim() || args.request.length > 6000) {
          throw new AgentSessionError('INVALID_PARAMS', '任务要求无效')
        }
        const gate = context.agentSession?.gateActiveTool()
        if (!gate) throw new AgentSessionError('SESSION_REQUIRED', '请先领取任务')
        if (args.sessionId !== gate.session.sessionId) throw new AgentSessionError('SESSION_NOT_FOUND', '任务编号无效')
        if (args.revision !== gate.session.revision) throw new AgentSessionError('REQUEST_UPDATED', '请先读取最新任务要求')
        if (!gate.allowed && gate.error?.code !== 'EXPORT_CONFIRMATION_PENDING') {
          throw new AgentSessionError(gate.error?.code ?? 'SESSION_NOT_ACTIVE', gate.error?.message ?? '任务不可用')
        }
        const session = context.agentSession!.updateRequest(args.sessionId, args.request)
        return { ok: true, result: { ok: true, summary: '任务要求已更新', data: { session, nextAction: 'get_edit_request' } } }
      }
      if (Object.keys(args).some(key => !['sessionId', 'revision', 'workflow'].includes(key))
        || typeof args.sessionId !== 'string' || !args.sessionId
        || !Number.isInteger(args.revision) || Number(args.revision) < 1
        || (args.workflow !== 'editing' && args.workflow !== 'director-plan')) {
        throw new AgentSessionError('INVALID_PARAMS', '处理流程参数无效')
      }
      if (!context.agentSession) throw new AgentSessionError('SESSION_REQUIRED', '请先领取任务')
      if (args.workflow === 'director-plan' && !context.directorPlanTools) throw new AgentSessionError('UNSUPPORTED', '导演计划暂不可用')
      const session = context.agentSession.selectWorkflow(args.sessionId, Number(args.revision), args.workflow)
      return { ok: true, result: { ok: true, summary: '已选择处理流程', data: { session,
        nextAction: 'list_agent_skills', skillFilter: { workflow: session.purpose } } } }
    } catch (error) {
      return { ok: true, result: { ok: false, error: {
        code: error instanceof AgentSessionError ? error.code : 'WORKFLOW_SELECTION_FAILED',
        message: error instanceof Error ? error.message : '选择处理流程失败', retryable: false,
      } } }
    }
  },
}
