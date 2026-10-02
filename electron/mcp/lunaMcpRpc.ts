import { randomUUID } from 'node:crypto'
import { AI_EDITOR_USER_STOPPED_ERROR } from '../../src/shared/types/aiEditor.ts'
import { addAgentContext, asRecord, isRpcId, jsonRpcError, contentForResponse, textForResult, contentWithAgentContext, agentToolErrorFromResult, exportPathFromToolResult, type JsonRpcRequest, type JsonRpcResponse, type LunaMcpServerOptions } from './lunaMcpProtocol.ts'
import { getToolCatalog } from './lunaMcpCatalog.ts'
import { handleDirectorPlanTool } from './directorPlanTools.ts'
import { handleAgentTaskTool, requestExplicitlyAsksForExport, requestRendererWithCancellation } from './lunaMcpTaskTools.ts'

const MCP_PROTOCOL_VERSION = '2024-11-05'

function isReadOnlyAgentTool(name: string): boolean {
  return name === 'get_editing_skill'
    || name.startsWith('list_')
    || name.startsWith('get_')
    || name.startsWith('inspect_')
    || name === 'create_media_contact_sheet'
    || name.startsWith('preview_')
    || name.startsWith('probe_')
}

export async function handleRpc(
  raw: unknown,
  options: LunaMcpServerOptions,
): Promise<JsonRpcResponse | null> {
  const request = asRecord(raw) as JsonRpcRequest | null
  const rawId = request?.id
  const id = isRpcId(rawId) ? rawId : null
  const method = typeof request?.method === 'string' ? request.method : null
  const isNotification = request !== null && !('id' in request)

  if (!request || request.jsonrpc !== '2.0' || !method) {
    return jsonRpcError(id, -32600, '无效的 JSON-RPC 请求')
  }

  if (isNotification) return null

  if (method === 'initialize') {
    const params = asRecord(request.params)
    const requestedVersion = typeof params?.protocolVersion === 'string'
      ? params.protocolVersion
      : MCP_PROTOCOL_VERSION
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'luna-ai-cut', version: '0.1.0' },
      },
    }
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }

  if (method === 'tools/list') {
    const catalog = await getToolCatalog(options)
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: catalog.tools,
        _meta: {
          luna: {
            editorToolsReady: catalog.editorToolsReady,
            ...(catalog.message ? { message: catalog.message } : {}),
          },
        },
      },
    }
  }

  if (method === 'tools/call') {
    const params = asRecord(request.params)
    const name = typeof params?.name === 'string' ? params.name : ''
    if (!name) return jsonRpcError(id, -32602, '缺少工具名称')
    const args = asRecord(params?.arguments) ?? {}
    const callId = randomUUID()
    const taskResult = await handleDirectorPlanTool(name, args, callId, options.directorPlanTools, options.agentSession)
      ?? await handleAgentTaskTool(name, args, options, callId)
    if (taskResult) {
      const taskRecord = asRecord(taskResult.result)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: contentForResponse(taskResult),
          isError: taskRecord?.ok === false,
          ...(taskResult.result && typeof taskResult.result === 'object'
            ? { structuredContent: taskResult.result }
            : {}),
        },
      }
    }

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
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(blocked) }],
            isError: true,
            structuredContent: blocked,
          },
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
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(blocked) }],
            isError: true,
            structuredContent: blocked,
          },
        }
      }
    }

    let exportSession: { sessionId: string; revision: number } | null = null
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
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: textForResult(blocked) }],
            isError: true,
            structuredContent: blocked,
          },
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
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: textForResult(blocked) }],
            isError: true,
            structuredContent: blocked,
          },
        }
      }
      if (name === 'export_video') {
        exportSession = { sessionId: gate.session.sessionId, revision: gate.session.revision }
        const confirmation = await options.agentSession.waitForExportConfirmation(
          gate.session.sessionId,
          gate.session.revision,
        )
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
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: textForResult(blocked) }],
              isError: true,
              structuredContent: blocked,
            },
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
      options.agentSession?.toolFinished(
        callId,
        name,
        args,
        false,
        bridgeResponse.error ?? 'AI 剪辑页面不可用',
        durationMs,
        { code: 'EDITOR_UNAVAILABLE', message: bridgeResponse.error ?? 'AI 剪辑页面不可用', retryable: true },
      )
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: textForResult(failure) }],
          isError: true,
          ...(failureRecord ? { structuredContent: failureRecord } : {}),
        },
      }
    }

    const contextualResult = addAgentContext(bridgeResponse.result, options.agentSession)
    const toolResult = asRecord(contextualResult)
    const toolError = toolResult?.ok === false ? agentToolErrorFromResult(toolResult) : undefined
    if (name === 'export_video' && exportSession && toolResult?.ok === true) {
      options.agentSession?.recordExportResult(
        exportSession.sessionId,
        exportSession.revision,
        exportPathFromToolResult(bridgeResponse.result),
      )
    }
    options.agentSession?.toolFinished(
      callId,
      name,
      args,
      toolResult?.ok !== false,
      typeof toolResult?.summary === 'string' ? toolResult.summary : '工具调用完成',
      durationMs,
      toolError,
    )
    const isError = toolResult?.ok === false
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: contextualResult === bridgeResponse.result
          ? contentForResponse(bridgeResponse)
          : contentWithAgentContext(bridgeResponse, contextualResult),
        isError,
        ...(contextualResult && typeof contextualResult === 'object'
          ? { structuredContent: contextualResult }
          : {}),
      },
    }
  }

  return jsonRpcError(id, -32601, `不支持的方法: ${method}`)
}
