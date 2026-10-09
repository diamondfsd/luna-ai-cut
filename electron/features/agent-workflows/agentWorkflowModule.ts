import type { LunaToolModule } from '../../mcp/lunaToolModule.ts'
import { AgentSessionError } from '../../mcp/agentSessionManager.ts'

/** Workflow selection is an Agent decision, gated by the claimed request revision. */
export const agentWorkflowModule: LunaToolModule = {
  id: 'agent-workflows',
  tools: [{
    name: 'select_task_workflow',
    description: 'After list_agent_skills/get_agent_skill, select the workflow declared by the matching App skill: shooting, footage-creation or editing-workspace. Requires the claimed session and current revision. Ask in the external conversation only when the task intent is materially ambiguous. Never switch an already chosen workflow.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { sessionId: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 1 },
        workflow: { type: 'string', enum: ['shooting', 'footage-creation', 'editing-workspace'] } },
      required: ['sessionId', 'revision', 'workflow'],
    },
  }, {
    name: 'update_task_request',
    description: 'Record a new user instruction or clarification from the current external conversation, verbatim. Accepts any existing task and its current revision, including after a result or cancellation. Never rewrite the request on behalf of the user. Preserves the first archived message. Read get_edit_request after success to acknowledge the new revision.',
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
        if (!context.agentSession) throw new AgentSessionError('SESSION_REQUIRED', '任务服务不可用')
        const session = await context.agentSession.continueRequest(args.sessionId, Number(args.revision), args.request)
        return { ok: true, result: { ok: true, summary: '任务要求已更新', data: { session, nextAction: 'get_edit_request' } } }
      }
      if (Object.keys(args).some(key => !['sessionId', 'revision', 'workflow'].includes(key))
        || typeof args.sessionId !== 'string' || !args.sessionId
        || !Number.isInteger(args.revision) || Number(args.revision) < 1
        || (args.workflow !== 'shooting' && args.workflow !== 'footage-creation' && args.workflow !== 'editing-workspace')) {
        throw new AgentSessionError('INVALID_PARAMS', '处理流程参数无效')
      }
      if (!context.agentSession) throw new AgentSessionError('SESSION_REQUIRED', '请先领取任务')
      if (args.workflow === 'shooting' && !context.directorPlanTools) throw new AgentSessionError('UNSUPPORTED', '拍摄计划暂不可用')
      const session = context.agentSession.selectWorkflow(args.sessionId, Number(args.revision), args.workflow)
      await context.activateWindow?.()
      return { ok: true, result: { ok: true, summary: '已选择处理流程', data: { session,
        guidance: 'Execute the already-read matching skill using its available tools. Workflow selection does not reveal new skills; do not repeat discovery just because it succeeded.' } } }
    } catch (error) {
      return { ok: true, result: { ok: false, error: {
        code: error instanceof AgentSessionError ? error.code : 'WORKFLOW_SELECTION_FAILED',
        message: error instanceof Error ? error.message : '选择处理流程失败', retryable: false,
      } } }
    }
  },
}
