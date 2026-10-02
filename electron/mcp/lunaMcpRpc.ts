import { appToolRegistry } from './lunaAppToolModules.ts'
import { randomUUID } from 'node:crypto'
import { asRecord, isRpcId, jsonRpcError, contentForResponse, type JsonRpcRequest, type JsonRpcResponse, type LunaMcpServerOptions } from './lunaMcpProtocol.ts'
import { getToolCatalog } from './lunaMcpCatalog.ts'

const MCP_PROTOCOL_VERSION = '2024-11-05'

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
    const registry = appToolRegistry(options)
    const module = registry.resolve(name)
    const purpose = options.agentSession?.snapshot().session?.purpose
    const policy = module ?? registry.fallback
    if (purpose && policy.allowedPurposes && !policy.allowedPurposes.includes(purpose)) {
      const blocked = { ok: false, error: { code: 'TASK_TYPE_CONFLICT', message: '当前任务不支持此操作', retryable: false } }
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(blocked) }], isError: true, structuredContent: blocked } }
    }
    const callId = randomUUID()
    const taskResult = module ? await module.execute(name, args, options, callId) : null
    if (module && !taskResult) return jsonRpcError(id, -32603, `工具模块未处理已注册工具: ${name}`)
    if (taskResult) {
      const taskRecord = asRecord(taskResult.result)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: contentForResponse(taskResult),
          isError: taskResult.ok === false || taskRecord?.ok === false,
          ...(taskResult.result && typeof taskResult.result === 'object'
            ? { structuredContent: taskResult.result }
            : {}),
        },
      }
    }

    return { jsonrpc: '2.0', id, result: await registry.fallback.execute(name, args, options, callId) }

  }

  return jsonRpcError(id, -32601, `不支持的方法: ${method}`)
}
