import { AI_EDITOR_USER_STOPPED_ERROR } from '../../src/shared/types/aiEditor.ts'
import { addAgentContext, asRecord, contentForResponse, textForResult, contentWithAgentContext, agentToolErrorFromResult, exportPathFromToolResult, type LunaMcpServerOptions } from './lunaMcpProtocol.ts'
import { requestExplicitlyAsksForExport, requestRendererWithCancellation } from './lunaMcpTaskTools.ts'

export const editorToolPolicy = { allowedPurposes: ['editing'] as readonly string[] }

function isReadOnlyAgentTool(name: string): boolean {
  return name === 'get_editing_skill' || name.startsWith('list_') || name.startsWith('get_')
      || name.startsWith('inspect_') || name === 'create_media_contact_sheet' || name.startsWith('preview_') || name.startsWith('probe_')
}
export async function executeEditorTool(name: string, args: Record<string, unknown>, options: LunaMcpServerOptions, callId: string) {
  const requiresFreshRequest = Boolean(options.agentSession) && !isReadOnlyAgentTool(name)
  if (requiresFreshRequest) {
      const gate = options.agentSession?.gateActiveTool()
      if (!gate) {
          const blocked = {
              ok: false,
              summary: '请先领取或创建剪辑任务',
              error: {
                  code: 'SESSION_REQUIRED',
                  message: '请先调用 wait_for_edit_request；如果任务来自外部对话，请调用 start_edit_session',
              },
          }
          return {
              content: [{ type: 'text', text: JSON.stringify(blocked) }],
              isError: true,
              structuredContent: blocked,
          }
      }
      if (!gate.allowed) {
          const blocked = {
              ok: false,
              summary: gate.error?.message ?? '任务不可用',
              data: { session: gate.session },
              error: gate.error,
          }
          return {
              content: [{ type: 'text', text: JSON.stringify(blocked) }],
              isError: true,
              structuredContent: blocked,
          }
      }
  }
  let exportSession: {
      sessionId: string
      revision: number
  } | null = null
  if ((name === 'export_video' || name === 'export_audio') && options.agentSession) {
      const gate = options.agentSession.gateActiveTool()
      if (!gate || !gate.allowed) {
          const blocked = {
              ok: false,
              summary: gate?.error?.message ?? '请先领取剪辑任务',
              data: gate ? { session: gate.session } : undefined,
              error: gate?.error ?? { code: 'SESSION_REQUIRED', message: '请先领取剪辑任务' },
          }
          return {
              content: [{ type: 'text', text: textForResult(blocked) }],
              isError: true,
              structuredContent: blocked,
          }
      }
      if (!requestExplicitlyAsksForExport(gate.session.request)) {
          const blocked = {
              ok: false,
              summary: '用户尚未明确要求导出，请先交付可预览的时间线',
              data: { session: gate.session },
              error: {
                  code: 'EXPORT_NOT_REQUESTED',
                  message: '当前用户要求没有明确要求导出，不能自动调用导出',
                  retryable: false,
                  suggestedAction: '不要继续调用导出；完成时间线后按 completed 上报，并等待用户预览后主动提出导出。',
              },
          }
          return {
              content: [{ type: 'text', text: textForResult(blocked) }],
              isError: true,
              structuredContent: blocked,
          }
      }
      if (name === 'export_video') {
          exportSession = { sessionId: gate.session.sessionId, revision: gate.session.revision }
          const confirmation = await options.agentSession.waitForExportConfirmation(gate.session.sessionId, gate.session.revision)
          if (!confirmation.approved) {
              const confirmationError = confirmation.code === AI_EDITOR_USER_STOPPED_ERROR.code
                  ? { ...AI_EDITOR_USER_STOPPED_ERROR }
                  : {
                      code: confirmation.code ?? 'EXPORT_CONFIRMATION_REQUIRED',
                      message: confirmation.message ?? '用户未确认导出，未执行导出',
                  }
              const blocked = {
                  ok: false,
                  summary: confirmation.message ?? '用户未确认导出',
                  error: confirmationError,
              }
              return {
                  content: [{ type: 'text', text: textForResult(blocked) }],
                  isError: true,
                  structuredContent: blocked,
              }
          }
      }
  }
  options.agentSession?.toolStarted(callId, name, args)
  const startedAt = Date.now()
  const bridgeResponse = await requestRendererWithCancellation(options, {
      callId,
      kind: 'callTool',
      name,
      args,
  })
  const durationMs = Date.now() - startedAt
  if (!bridgeResponse.ok) {
      const failure = addAgentContext({
          ok: false,
          summary: bridgeResponse.error ?? 'AI 剪辑页面不可用',
          error: {
              code: 'EDITOR_UNAVAILABLE',
              message: bridgeResponse.error ?? 'AI 剪辑页面不可用',
          },
      }, options.agentSession)
      const failureRecord = asRecord(failure)
      options.agentSession?.toolFinished(callId, name, args, false, bridgeResponse.error ?? 'AI 剪辑页面不可用', durationMs, { code: 'EDITOR_UNAVAILABLE', message: bridgeResponse.error ?? 'AI 剪辑页面不可用', retryable: true })
      return {
          content: [{ type: 'text', text: textForResult(failure) }],
          isError: true,
          ...(failureRecord ? { structuredContent: failureRecord } : {}),
      }
  }
  const contextualResult = addAgentContext(bridgeResponse.result, options.agentSession)
  const toolResult = asRecord(contextualResult)
  const toolError = toolResult?.ok === false ? agentToolErrorFromResult(toolResult) : undefined
  if (name === 'export_video' && exportSession && toolResult?.ok === true) {
      options.agentSession?.recordExportResult(exportSession.sessionId, exportSession.revision, exportPathFromToolResult(bridgeResponse.result))
  }
  options.agentSession?.toolFinished(callId, name, args, toolResult?.ok !== false, typeof toolResult?.summary === 'string' ? toolResult.summary : '工具调用完成', durationMs, toolError)
  const isError = toolResult?.ok === false
  return {
      content: contextualResult === bridgeResponse.result
          ? contentForResponse(bridgeResponse)
          : contentWithAgentContext(bridgeResponse, contextualResult),
      isError,
      ...(contextualResult && typeof contextualResult === 'object'
          ? { structuredContent: contextualResult }
          : {}),
  }
}
