import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { AiEditorAgentPhase, AiEditorMcpContent, AiEditorMcpRequest, AiEditorMcpResponse } from '../../src/shared/types'
import { AgentSessionError, AgentSessionManager, type AgentToolResult } from './agentSessionManager.ts'

const MCP_PROTOCOL_VERSION = '2024-11-05'
const MAX_BODY_BYTES = 2 * 1024 * 1024

type RpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: RpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface LunaMcpEndpoint {
  version: 1
  url: string
  token: string
  pid: number
}

export interface LunaMcpServerOptions {
  homeDir?: string
  requestRenderer(request: AiEditorMcpRequest): Promise<AiEditorMcpResponse>
  agentSession?: AgentSessionManager
  activateWindow?: () => void | Promise<void>
  musicGeneration?: MusicGenerationGateway
}

export interface MusicGenerationGateway {
  getStatus(): Promise<unknown>
  start(request: { prompt: string; durationSec: number; outputPath?: string }): Promise<unknown>
  getTask(taskId: string): unknown
  generate(request: { prompt: string; durationSec: number; outputPath?: string }): Promise<unknown>
  cancel(taskId: string): unknown
}

export interface LunaMcpServer {
  start(): Promise<LunaMcpEndpoint>
  stop(): Promise<void>
  endpointPath: string
}

function endpointPathFor(homeDir: string): string {
  return path.join(homeDir, '.luna-ai-cut', 'mcp-endpoint.json')
}

function isRpcId(value: unknown): value is RpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function jsonRpcError(id: RpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function textForResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function contentForResponse(response: AiEditorMcpResponse): AiEditorMcpContent[] {
  if (response.content && response.content.length > 0) return [...response.content]
  return [{ type: 'text', text: textForResult(response.result) }]
}

const AGENT_TASK_TOOLS = [
  {
    name: 'start_edit_session',
    description: 'Create and immediately claim an editing session for a request that came from outside Luna AI Cut, such as another Agent chat. Use the exact user request; do not invent a sessionId.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', minLength: 1, description: 'The exact user editing request received by the external Agent.' },
        agentId: { type: 'string', description: 'Optional stable name for this external Agent.' },
        projectId: { type: 'string', description: 'Optional existing project id to associate with the session.' },
      },
      required: ['request'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_edit_request',
    description: 'Wait for and claim the latest user editing request from Luna AI Cut. Call this before editing tools.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Optional stable name for this external Agent.' },
        timeoutSec: { type: 'number', minimum: 5, maximum: 900, description: 'How long to wait when there is no queued request. Defaults to 300 seconds.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_edit_request',
    description: 'Get the latest user editing request and revision. Call this whenever the user changes the request or before a major editing phase.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        knownRevision: { type: 'integer', minimum: 1 },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_edit_progress',
    description: 'Report the current editing phase and progress to Luna AI Cut. Do not write a natural-language status reply instead of using this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        revision: { type: 'integer', minimum: 1 },
        phase: { type: 'string', enum: ['waiting', 'analyzing_media', 'creating_project', 'importing_media', 'editing', 'captioning', 'saving', 'exporting'] },
        progress: { type: 'number', minimum: 0, maximum: 100 },
        message: { type: 'string' },
      },
      required: ['sessionId', 'revision', 'phase', 'progress', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_edit_result',
    description: 'Report the final edit result to Luna AI Cut. The Luna chat page uses this structured result as the authoritative completion message.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        revision: { type: 'integer', minimum: 1 },
        status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] },
        summary: { type: 'string' },
        projectId: { type: 'string' },
        projectName: { type: 'string' },
        exportPath: { type: 'string' },
      },
      required: ['sessionId', 'revision', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'activate_luna_window',
    description: 'Show Luna AI Cut, bring it to the foreground, open the AI editing page, and show the external Agent progress panel.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_edit_request',
    description: 'Cancel an active Luna editing request when the user asks the Agent to stop.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
] as const

const MUSIC_TOOLS = [
  {
    name: 'get_music_generation_status',
    description: 'Return the local MusicGen model status and recent background-music tasks. This tool never downloads models or dependencies.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'generate_music',
    description: 'Generate a local WAV background-music clip with MusicGen. Use instrumental, no-vocals wording by default; the duration is limited to 1-30 seconds per clip.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 2_000, description: 'A concise description of instrumental background music.' },
        durationSec: { type: 'number', minimum: 1, maximum: 30, default: 10, description: 'Clip duration in seconds.' },
        outputPath: { type: 'string', description: 'Optional WAV path under the local generated-audio directory.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'start_music_generation',
    description: 'Start local MusicGen background-music generation and return a task id immediately. Poll with get_music_generation or cancel it with cancel_music_generation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 2_000 },
        durationSec: { type: 'number', minimum: 1, maximum: 30, default: 10 },
        outputPath: { type: 'string', description: 'Optional WAV path under the local generated-audio directory.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_music_generation',
    description: 'Return the status, progress, error, or output of a MusicGen generation task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', minLength: 1 } },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_music_generation',
    description: 'Cancel a running local MusicGen generation task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', minLength: 1 } },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
] as const

const AGENT_TOOL_NAMES = new Set<string>(AGENT_TASK_TOOLS.map((tool) => tool.name))
const MUSIC_TOOL_NAMES = new Set<string>(MUSIC_TOOLS.map((tool) => tool.name))

function stringArg(args: Record<string, unknown>, name: string): string | null {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function integerArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = numberArg(args, name)
  return value !== undefined && Number.isInteger(value) ? value : undefined
}

const AGENT_PROGRESS_PHASES = new Set<AiEditorAgentPhase>([
  'waiting',
  'analyzing_media',
  'creating_project',
  'importing_media',
  'editing',
  'captioning',
  'saving',
  'exporting',
])

function isAgentProgressPhase(value: string | null): value is AiEditorAgentPhase {
  return value !== null && AGENT_PROGRESS_PHASES.has(value as AiEditorAgentPhase)
}

function agentToolResponse(result: AgentToolResult | Record<string, unknown>): AiEditorMcpResponse {
  return { ok: true, result }
}

function agentInvalidParams(message: string): AiEditorMcpResponse {
  return agentToolResponse({
    ok: false,
    summary: message,
    error: { code: 'INVALID_PARAMS', message },
  })
}

async function handleAgentTaskTool(
  name: string,
  args: Record<string, unknown>,
  options: LunaMcpServerOptions,
): Promise<AiEditorMcpResponse | null> {
  if (!AGENT_TOOL_NAMES.has(name)) return null
  const manager = options.agentSession
  if (!manager) return agentToolResponse({
    ok: false,
    summary: '外部 Agent 任务服务不可用',
    error: { code: 'UNSUPPORTED', message: '外部 Agent 任务服务不可用' },
  })

  try {
    if (name === 'start_edit_session') {
      const request = stringArg(args, 'request')
      if (!request) return agentInvalidParams('缺少 request，请传入用户原始剪辑要求')
      const result = manager.startExternalRequest(
        request,
        stringArg(args, 'agentId'),
        stringArg(args, 'projectId'),
      )
      await options.activateWindow?.()
      return agentToolResponse({
        ok: true,
        summary: '已创建并领取外部剪辑任务',
        data: result,
      })
    }

    if (name === 'wait_for_edit_request') {
      const result = await manager.waitForRequest(stringArg(args, 'agentId'), numberArg(args, 'timeoutSec'))
      if (result.state === 'claimed') await options.activateWindow?.()
      return agentToolResponse({
        ok: true,
        summary: result.state === 'claimed' ? '已领取 Luna 剪辑任务' : '当前没有新的剪辑任务',
        data: result.state === 'idle'
          ? { ...result, nextAction: '如任务来自外部对话，请调用 start_edit_session 并传入用户原始要求' }
          : result,
      })
    }

    if (name === 'get_edit_request') {
      const sessionId = stringArg(args, 'sessionId')
      if (!sessionId) return agentInvalidParams('缺少 sessionId')
      const knownRevision = args.knownRevision === undefined ? undefined : integerArg(args, 'knownRevision')
      if (args.knownRevision !== undefined && knownRevision === undefined) return agentInvalidParams('knownRevision 必须是正整数')
      const result = manager.getRequest(sessionId, knownRevision)
      return agentToolResponse({
        ok: true,
        summary: result.changed ? '用户剪辑要求已更新' : '剪辑要求没有变化',
        data: result,
      })
    }

    if (name === 'report_edit_progress') {
      const sessionId = stringArg(args, 'sessionId')
      const revision = integerArg(args, 'revision')
      const phase = stringArg(args, 'phase')
      const progress = numberArg(args, 'progress')
      const message = stringArg(args, 'message')
      if (!sessionId || revision === undefined || !isAgentProgressPhase(phase) || progress === undefined || progress < 0 || progress > 100 || !message) {
        return agentInvalidParams('缺少进度上报参数')
      }
      return agentToolResponse(manager.reportProgress(sessionId, revision, phase, progress, message))
    }

    if (name === 'report_edit_result') {
      const sessionId = stringArg(args, 'sessionId')
      const revision = integerArg(args, 'revision')
      const status = stringArg(args, 'status')
      if (!sessionId || revision === undefined || (status !== 'completed' && status !== 'failed' && status !== 'cancelled')) {
        return agentInvalidParams('缺少结果上报参数')
      }
      return agentToolResponse(manager.reportResult(
        sessionId,
        revision,
        status,
        stringArg(args, 'summary') ?? undefined,
        stringArg(args, 'projectId') ?? undefined,
        stringArg(args, 'projectName') ?? undefined,
        stringArg(args, 'exportPath') ?? undefined,
      ))
    }

    if (name === 'activate_luna_window') {
      await options.activateWindow?.()
      return agentToolResponse({ ok: true, summary: 'Luna AI Cut 已切到前台' })
    }

    const sessionId = stringArg(args, 'sessionId')
    if (!sessionId) return agentInvalidParams('缺少 sessionId')
    return agentToolResponse({ ok: true, summary: '已请求停止剪辑任务', data: manager.cancelRequest(sessionId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof AgentSessionError ? error.code : 'AGENT_SESSION_ERROR'
    return agentToolResponse({ ok: false, summary: message, error: { code, message } })
  }
}

function musicToolResponse(data: unknown): AiEditorMcpResponse {
  return { ok: true, result: { ok: true, summary: '音乐工具调用完成', data } }
}

function musicToolError(code: string, message: string): AiEditorMcpResponse {
  return {
    ok: true,
    result: { ok: false, summary: message, error: { code, message } },
  }
}

async function handleMusicTool(
  name: string,
  args: Record<string, unknown>,
  gateway?: MusicGenerationGateway,
): Promise<AiEditorMcpResponse | null> {
  if (!MUSIC_TOOL_NAMES.has(name)) return null
  if (!gateway) return musicToolError('UNSUPPORTED', '本地音乐工具不可用')

  try {
    if (name === 'get_music_generation_status') return musicToolResponse(await gateway.getStatus())

    const prompt = stringArg(args, 'prompt')
    const durationSec = args.durationSec === undefined ? 10 : numberArg(args, 'durationSec')
    const outputPath = stringArg(args, 'outputPath') ?? undefined
    if (name === 'generate_music' || name === 'start_music_generation') {
      if (!prompt) return musicToolError('INVALID_PARAMS', '缺少 prompt，请描述需要的背景音乐')
      if (durationSec === undefined || durationSec < 1 || durationSec > 30) return musicToolError('INVALID_PARAMS', 'durationSec 必须在 1 到 30 秒之间')
      const request = { prompt, durationSec, ...(outputPath ? { outputPath } : {}) }
      return musicToolResponse(name === 'generate_music'
        ? await gateway.generate(request)
        : await gateway.start(request))
    }

    const taskId = stringArg(args, 'taskId')
    if (!taskId) return musicToolError('INVALID_PARAMS', '缺少 taskId')
    if (name === 'get_music_generation') {
      const result = gateway.getTask(taskId)
      if (!result) return musicToolError('TASK_NOT_FOUND', 'MusicGen 任务不存在')
      return musicToolResponse(result)
    }
    return musicToolResponse(gateway.cancel(taskId))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return musicToolError('MUSIC_GENERATION_FAILED', message)
  }
}

function addAgentContext(result: unknown, manager?: AgentSessionManager): unknown {
  const context = manager?.activeContext()
  const record = asRecord(result)
  if (!context || !record) return result
  const existingData = asRecord(record.data)
  return {
    ...record,
    data: {
      ...(existingData ?? (record.data === undefined ? {} : { value: record.data })),
      lunaAgent: {
        sessionId: context.sessionId,
        requestRevision: context.revision,
        requestChanged: context.changed,
        ...(context.changed ? { latestRequest: context.request } : {}),
      },
    },
  }
}

function isReadOnlyAgentTool(name: string): boolean {
  return name === 'get_editing_skill'
    || name.startsWith('list_')
    || name.startsWith('get_')
    || name.startsWith('inspect_')
    || name.startsWith('preview_')
    || name.startsWith('probe_')
}

async function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求内容过大'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function authorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`
}

async function handleRpc(
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
    const bridgeResponse = await options.requestRenderer({
      callId: randomUUID(),
      kind: 'listTools',
    })
    if (!bridgeResponse.ok) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [...AGENT_TASK_TOOLS, ...MUSIC_TOOLS],
          _meta: {
            luna: {
              editorToolsReady: false,
              message: bridgeResponse.error ?? 'AI 剪辑页面尚未加载，请领取任务后激活 Luna 并重新调用 tools/list',
            },
          },
        },
      }
    }
    const rendererTools = Array.isArray(bridgeResponse.result) ? bridgeResponse.result : []
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [...AGENT_TASK_TOOLS, ...MUSIC_TOOLS, ...rendererTools],
        _meta: { luna: { editorToolsReady: rendererTools.length > 0 } },
      },
    }
  }

  if (method === 'tools/call') {
    const params = asRecord(request.params)
    const name = typeof params?.name === 'string' ? params.name : ''
    if (!name) return jsonRpcError(id, -32602, '缺少工具名称')
    const args = asRecord(params?.arguments) ?? {}
    const taskResult = await handleAgentTaskTool(name, args, options)
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

    const callId = randomUUID()
    const requiresFreshRequest = Boolean(options.agentSession)
      && !MUSIC_TOOL_NAMES.has(name)
      && !isReadOnlyAgentTool(name)
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

    const musicResult = await handleMusicTool(name, args, options.musicGeneration)
    if (musicResult) {
      const result = addAgentContext(musicResult.result, options.agentSession)
      const record = asRecord(result)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: textForResult(result) }],
          isError: record?.ok === false,
          ...(record ? { structuredContent: record } : {}),
        },
      }
    }

    options.agentSession?.toolStarted(callId, name, args)
    const startedAt = Date.now()
    const bridgeResponse = await options.requestRenderer({
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
      options.agentSession?.toolFinished(callId, name, args, false, bridgeResponse.error ?? 'AI 剪辑页面不可用', durationMs)
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
    options.agentSession?.toolFinished(
      callId,
      name,
      args,
      toolResult?.ok !== false,
      typeof toolResult?.summary === 'string' ? toolResult.summary : '工具调用完成',
      durationMs,
    )
    const isError = toolResult?.ok === false
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: contextualResult === bridgeResponse.result
          ? contentForResponse(bridgeResponse)
          : [{ type: 'text', text: textForResult(contextualResult) }, ...contentForResponse(bridgeResponse).filter((item) => item.type !== 'text')],
        isError,
        ...(contextualResult && typeof contextualResult === 'object'
          ? { structuredContent: contextualResult }
          : {}),
      },
    }
  }

  return jsonRpcError(id, -32601, `不支持的方法: ${method}`)
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  options: LunaMcpServerOptions,
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/rpc') {
    writeJson(response, 404, { error: 'Not found' })
    return
  }
  if (!authorized(request, token)) {
    writeJson(response, 401, { error: 'Unauthorized' })
    return
  }

  try {
    const body = await readBody(request)
    const parsed = JSON.parse(body) as unknown
    const result = await handleRpc(parsed, options)
    if (result === null) {
      response.statusCode = 204
      response.end()
      return
    }
    writeJson(response, 200, result)
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function createLunaMcpServer(options: LunaMcpServerOptions): LunaMcpServer {
  const homeDir = options.homeDir ?? os.homedir()
  const endpointPath = endpointPathFor(homeDir)
  let server: Server | null = null
  let endpoint: LunaMcpEndpoint | null = null

  return {
    endpointPath,
    async start(): Promise<LunaMcpEndpoint> {
      if (server && endpoint) return endpoint

      const token = randomBytes(32).toString('hex')
      server = createServer((request, response) => {
        void handleHttpRequest(request, response, token, options)
      })
      await new Promise<void>((resolve, reject) => {
        const current = server as Server
        current.once('error', reject)
        current.listen(0, '127.0.0.1', () => {
          current.off('error', reject)
          resolve()
        })
      })

      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('MCP 服务启动失败')
      endpoint = {
        version: 1,
        url: `http://127.0.0.1:${address.port}/rpc`,
        token,
        pid: process.pid,
      }
      await mkdir(path.dirname(endpointPath), { recursive: true })
      await writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      return endpoint
    },
    async stop(): Promise<void> {
      const current = server
      server = null
      endpoint = null
      if (current) {
        await new Promise<void>((resolve) => current.close(() => resolve()))
      }
      await readFile(endpointPath, 'utf8')
        .then((value) => {
          try {
            const saved = JSON.parse(value) as Partial<LunaMcpEndpoint>
            if (saved.pid === process.pid) return rm(endpointPath, { force: true })
          } catch {
            return undefined
          }
          return undefined
        })
        .catch(() => undefined)
    },
  }
}
