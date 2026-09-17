import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  AI_EDITOR_USER_STOPPED_ERROR,
  createAiEditorUserStoppedResult,
  type AiEditorAgentPhase,
  type AiEditorMcpContent,
  type AiEditorMcpRequest,
  type AiEditorMcpResponse,
} from '../../src/shared/types/aiEditor.ts'
import type {
  GeneratedMusic,
  MusicTemplateDocument,
  MusicTemplateSummary,
} from '../features/music/musicGenerationService.ts'
import { AgentSessionError, AgentSessionManager, type AgentToolError, type AgentToolResult } from './agentSessionManager.ts'
import { LUNA_HTTP_SKILL } from './lunaHttpSkill.ts'

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
  baseUrl: string
  skillUrl: string
  toolsUrl: string
  openapiUrl: string
  apiUrl: string
  pid: number
}

export interface LunaHttpConnection {
  baseUrl: string
  skillUrl: string
  toolsUrl: string
  openapiUrl: string
  apiUrl: string
}

export interface LunaMcpServerOptions {
  homeDir?: string
  requestRenderer(request: AiEditorMcpRequest): Promise<AiEditorMcpResponse>
  agentSession?: AgentSessionManager
  activateWindow?: () => void | Promise<void>
  musicTools?: {
    listMusicTemplates(options?: {
      tag?: string
      scene?: string
      dialogueSafe?: boolean
      limit?: number
    }): Promise<MusicTemplateSummary[]>
    getMusicTemplate(templateId: string): Promise<MusicTemplateDocument>
    generateBackgroundMusic(dsl: string, name?: string): Promise<GeneratedMusic>
  }
}

export interface LunaMcpServer {
  start(): Promise<LunaMcpEndpoint>
  getEndpoint(): Promise<LunaMcpEndpoint>
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

function exportPathFromToolResult(value: unknown): string | null {
  const result = asRecord(value)
  if (result?.ok !== true) return null
  const data = asRecord(result.data)
  const exportPath = data?.path ?? data?.outputPath
  return typeof exportPath === 'string' && exportPath.trim() ? exportPath.trim() : null
}

function agentToolErrorFromResult(value: unknown): AgentToolError | undefined {
  const record = asRecord(value)
  const error = asRecord(record?.error)
  if (typeof error?.code !== 'string' || typeof error.message !== 'string') return undefined
  return {
    code: error.code,
    message: error.message,
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
    ...(typeof error.suggestedAction === 'string' ? { suggestedAction: error.suggestedAction } : {}),
  }
}

function contentForResponse(response: AiEditorMcpResponse): AiEditorMcpContent[] {
  if (response.content && response.content.length > 0) return [...response.content]
  return [{ type: 'text', text: textForResult(response.result) }]
}

function contentWithAgentContext(
  response: AiEditorMcpResponse,
  contextualResult: unknown,
): AiEditorMcpContent[] {
  const content = contentForResponse(response)
  const contextualText: AiEditorMcpContent = {
    type: 'text',
    text: textForResult(contextualResult),
  }
  const firstTextIndex = content.findIndex((item) => item.type === 'text')
  if (firstTextIndex < 0) return [contextualText, ...content]
  return content.map((item, index) => index === firstTextIndex ? contextualText : item)
}

interface ToolCatalog {
  tools: unknown[]
  editorToolsReady: boolean
  message?: string
}

async function getToolCatalog(options: LunaMcpServerOptions): Promise<ToolCatalog> {
  let bridgeResponse: AiEditorMcpResponse
  try {
    bridgeResponse = await options.requestRenderer({
      callId: randomUUID(),
      kind: 'listTools',
    })
  } catch (error) {
    return {
      tools: [...AGENT_TASK_TOOLS],
      editorToolsReady: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  if (!bridgeResponse.ok) {
    return {
      tools: [...AGENT_TASK_TOOLS],
      editorToolsReady: false,
      message: bridgeResponse.error ?? 'AI 剪辑页面尚未加载，请领取任务后激活 Luna 并重新获取工具清单',
    }
  }
  const rendererTools = Array.isArray(bridgeResponse.result) ? bridgeResponse.result : []
  return {
    tools: [...AGENT_TASK_TOOLS, ...rendererTools],
    editorToolsReady: rendererTools.length > 0,
  }
}

function toolName(value: unknown): string | null {
  const record = asRecord(value)
  return typeof record?.name === 'string' && record.name.trim() ? record.name : null
}

function openApiDocument(baseUrl: string, catalog: ToolCatalog): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const tool of catalog.tools) {
    const record = asRecord(tool)
    const name = toolName(tool)
    if (!record || !name) continue
    paths[`/api/tools/${encodeURIComponent(name)}`] = {
      post: {
        operationId: `call_${name}`,
        summary: typeof record.description === 'string' ? record.description : name,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  arguments: record.inputSchema ?? { type: 'object' },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          '200': { description: 'Tool result' },
        },
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Luna AI Cut Local Agent API',
      version: '1.0.0',
      description: 'Local HTTP tool API for controlling the Luna AI Cut desktop editor.',
    },
    servers: [{ url: baseUrl }],
    paths,
    'x-luna': {
      skill: '/skill.md',
      tools: '/tools',
      editorToolsReady: catalog.editorToolsReady,
      ...(catalog.message ? { message: catalog.message } : {}),
    },
  }
}

const AGENT_TASK_TOOLS = [
  {
    name: 'start_edit_session',
    description: 'Create and immediately claim an editing session for a request that came from outside Luna AI Cut. Include the exact user request, a stable agentId, the Agent category, and the actual model name; do not invent a sessionId or identity.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', minLength: 1, description: 'The exact user editing request received by the external Agent.' },
        agentId: { type: 'string', minLength: 1, description: 'Stable identifier for this external Agent.' },
        agentType: { type: 'string', minLength: 1, description: 'Agent category or role, for example WorkBuddy external editing Agent.' },
        agentModel: { type: 'string', minLength: 1, description: 'The model name actually used by this Agent.' },
        projectId: { type: 'string', description: 'Optional existing project id to associate with the session.' },
      },
      required: ['request', 'agentId', 'agentType', 'agentModel'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_edit_request',
    description: 'Wait for and claim the latest user editing request from Luna AI Cut. Register the Agent identity when waiting or claiming.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', minLength: 1, description: 'Stable identifier for this external Agent.' },
        agentType: { type: 'string', minLength: 1, description: 'Agent category or role, for example WorkBuddy external editing Agent.' },
        agentModel: { type: 'string', minLength: 1, description: 'The model name actually used by this Agent.' },
        timeoutSec: { type: 'number', minimum: 5, maximum: 900, description: 'How long to wait when there is no queued request. Defaults to 300 seconds.' },
      },
      required: ['agentId', 'agentType', 'agentModel'],
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
    description: 'Notify Luna AI Cut to open the AI editing page and show the external Agent progress panel without bringing the app to the foreground.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_music_templates',
    description: 'List built-in background-music templates. Use this before writing a Music DSL when the user asks for music, BGM, or a stronger rhythmic edit.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Optional template tag such as travel, cinematic, upbeat, or dialogue-safe.' },
        scene: { type: 'string', description: 'Optional scene tag such as travel, documentary, product, or holiday.' },
        dialogueSafe: { type: 'boolean', description: 'When true, only return arrangements suitable under narration or dialogue.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of templates to return. Defaults to 50.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_music_template',
    description: 'Get one built-in music template and its editable compact Music DSL. Adapt the DSL instead of returning or rendering the original user request.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', minLength: 1, description: 'Template id returned by list_music_templates.' },
      },
      required: ['templateId'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_background_music',
    description: 'Render a compact Music DSL to an instrumental WAV inside Luna, register it as local audio media, and return the mediaId to import with import_local_media. Do not pass a natural-language brief or JSON note array.',
    inputSchema: {
      type: 'object',
      properties: {
        dsl: { type: 'string', minLength: 1, description: 'A compact video-bgm DSL document. Start with bgm 1, then duration, tempo, meter, sections, and tracks.' },
        name: { type: 'string', maxLength: 120, description: 'Optional user-facing file name without a path.' },
      },
      required: ['dsl'],
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

const AGENT_TOOL_NAMES = new Set<string>(AGENT_TASK_TOOLS.map((tool) => tool.name))
const MUSIC_TOOL_NAMES = new Set(['list_music_templates', 'get_music_template', 'generate_background_music'])

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

function requestExplicitlyAsksForExport(request: string): boolean {
  const normalized = request.trim().toLowerCase()
  if (!normalized) return false

  const declined = [
    /(?:先|暂时|现在)?不要导出/,
    /(?:先|暂时|现在)?别导出/,
    /(?:先|暂时|现在)?无需导出/,
    /(?:剪辑完后|完成后|稍后|之后)?再(?:考虑|决定)?[\s\S]{0,4}导出/,
    /\b(?:do not|don't|dont|without)\s+(?:export|render|save)\b/,
  ].some((pattern) => pattern.test(normalized))
  if (declined) return false

  return /(导出|导出视频|导出音频|输出成片|导出成片|生成成片|保存成片|渲染成片)/.test(normalized)
    || /\b(?:export|render|save)(?:\s+(?:the|this|a))?\s+(?:video|audio|movie|file)\b/.test(normalized)
}

function agentToolResponse(result: AgentToolResult | Record<string, unknown>): AiEditorMcpResponse {
  return { ok: true, result }
}

function userStoppedResponse(): AiEditorMcpResponse {
  return agentToolResponse(createAiEditorUserStoppedResult())
}

function requestRendererWithCancellation(
  options: LunaMcpServerOptions,
  request: AiEditorMcpRequest,
): Promise<AiEditorMcpResponse> {
  const manager = options.agentSession
  if (!manager) return options.requestRenderer(request)

  return new Promise<AiEditorMcpResponse>((resolve, reject) => {
    let settled = false
    const unsubscribe = manager.subscribe((event) => {
      if (event.type !== 'cancelled' || !event.session.cancelRequested || settled) return
      settled = true
      unsubscribe()
      resolve(userStoppedResponse())
    })
    void options.requestRenderer(request).then(
      (response) => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve(response)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        unsubscribe()
        reject(error)
      },
    )
  })
}

function agentInvalidParams(message: string): AiEditorMcpResponse {
  return agentToolResponse({
    ok: false,
    summary: message,
    error: { code: 'INVALID_PARAMS', message },
  })
}

async function handleMusicTool(
  name: string,
  args: Record<string, unknown>,
  options: LunaMcpServerOptions,
  callId: string,
): Promise<AiEditorMcpResponse | null> {
  if (!MUSIC_TOOL_NAMES.has(name)) return null

  if (name === 'generate_background_music') {
    const gate = options.agentSession?.gateActiveTool()
    if (!gate || !gate.allowed) {
      const message = gate?.error?.message ?? '请先领取或创建剪辑任务'
      return agentToolResponse({
        ok: false,
        summary: message,
        data: gate ? { session: gate.session } : undefined,
        error: gate?.error ?? { code: 'SESSION_REQUIRED', message },
      })
    }
  }

  const startedAt = Date.now()
  options.agentSession?.toolStarted(callId, name, args)
  const invalid = (message: string): AiEditorMcpResponse => {
    options.agentSession?.toolFinished(
      callId,
      name,
      args,
      false,
      message,
      Date.now() - startedAt,
      { code: 'INVALID_PARAMS', message },
    )
    return agentInvalidParams(message)
  }
  try {
    const music = options.musicTools
    if (!music) {
      const message = 'Luna 内置音乐引擎不可用，请重启应用后重试'
      const error = {
        code: 'MUSIC_RUNTIME_UNAVAILABLE',
        message,
        retryable: false,
        suggestedAction: '停止音乐生成并上报失败；这是 Luna 本地音乐运行时未注册，不是 DSL 参数问题。',
      }
      options.agentSession?.toolFinished(callId, name, args, false, message, Date.now() - startedAt, error)
      return agentToolResponse({ ok: false, summary: message, error })
    }
    if (name === 'list_music_templates') {
      const limit = args.limit === undefined ? undefined : integerArg(args, 'limit')
      if (args.limit !== undefined && limit === undefined) return invalid('limit 必须是正整数')
      const templates = await music.listMusicTemplates({
        tag: stringArg(args, 'tag') ?? undefined,
        scene: stringArg(args, 'scene') ?? undefined,
        dialogueSafe: typeof args.dialogueSafe === 'boolean' ? args.dialogueSafe : undefined,
        limit,
      })
      const result = addAgentContext({
        ok: true,
        summary: `找到 ${templates.length} 个背景音乐模板`,
        data: { templates },
      }, options.agentSession)
      options.agentSession?.toolFinished(callId, name, args, true, `找到 ${templates.length} 个背景音乐模板`, Date.now() - startedAt)
      return agentToolResponse(result as Record<string, unknown>)
    }

    if (name === 'get_music_template') {
      const templateId = stringArg(args, 'templateId')
      if (!templateId) return invalid('缺少 templateId')
      const template = await music.getMusicTemplate(templateId)
      const result = addAgentContext({
        ok: true,
        summary: `已读取音乐模板 ${templateId}`,
        data: { template },
      }, options.agentSession)
      options.agentSession?.toolFinished(callId, name, args, true, `已读取音乐模板 ${templateId}`, Date.now() - startedAt)
      return agentToolResponse(result as Record<string, unknown>)
    }

    const dsl = typeof args.dsl === 'string' && args.dsl.trim() ? args.dsl : null
    if (!dsl) return invalid('缺少 dsl')
    const generated = await music.generateBackgroundMusic(dsl, stringArg(args, 'name') ?? undefined)
    const summary = `已生成背景音乐 ${generated.name}（${generated.durationSec.toFixed(2)} 秒）`
    const result = addAgentContext({
      ok: true,
      summary,
      data: generated,
    }, options.agentSession)
    options.agentSession?.toolFinished(callId, name, args, true, summary, Date.now() - startedAt)
    return agentToolResponse(result as Record<string, unknown>)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const templateNotFound = name === 'get_music_template'
      && /unknown music template|音乐模板内容无效/i.test(message)
    const invalidDsl = name === 'generate_background_music'
      && /^line \d+:/m.test(message)
    const runtimeUnavailable = /SoundFont was not found|luna-bgm-worker|ENOENT|Cannot find module/i.test(message)
    const toolError = templateNotFound
      ? {
          code: 'MUSIC_TEMPLATE_NOT_FOUND',
          message,
          retryable: false,
          suggestedAction: '重新调用 list_music_templates，并使用返回的 templateId。',
        }
      : invalidDsl
        ? {
            code: 'MUSIC_DSL_INVALID',
            message,
            retryable: false,
            suggestedAction: '按错误行号修正 Music DSL，再调用一次；不要重复原参数。',
          }
        : runtimeUnavailable
          ? {
              code: 'MUSIC_RUNTIME_UNAVAILABLE',
              message,
              retryable: false,
              suggestedAction: '停止音乐生成并上报失败；这是 Luna 本地音乐运行时缺失，不是 DSL 参数问题。',
            }
          : {
              code: 'MUSIC_RENDER_FAILED',
              message,
              retryable: false,
              suggestedAction: '检查 Music DSL 的时值和轨道定义；修正后再调用一次，不要重复原参数。',
            }
    const failure = {
      ok: false,
      summary: message,
      error: toolError,
    }
    options.agentSession?.toolFinished(callId, name, args, false, message, Date.now() - startedAt, toolError)
    return agentToolResponse(failure)
  }
}

async function handleAgentTaskTool(
  name: string,
  args: Record<string, unknown>,
  options: LunaMcpServerOptions,
  callId: string,
): Promise<AiEditorMcpResponse | null> {
  if (!AGENT_TOOL_NAMES.has(name)) return null
  const manager = options.agentSession
  if (manager) {
    const currentSession = manager.snapshot().session
    if (
      currentSession?.status === 'cancelled'
      && currentSession.cancelRequested
      && name !== 'start_edit_session'
      && name !== 'wait_for_edit_request'
      && name !== 'activate_luna_window'
    ) {
      return userStoppedResponse()
    }
  }

  const musicResult = await handleMusicTool(name, args, options, callId)
  if (musicResult) return musicResult
  if (!manager) return agentToolResponse({
    ok: false,
    summary: '外部 Agent 任务服务不可用',
    error: { code: 'UNSUPPORTED', message: '外部 Agent 任务服务不可用' },
  })

  try {
    if (name === 'start_edit_session') {
      const request = stringArg(args, 'request')
      const agentId = stringArg(args, 'agentId')
      const agentType = stringArg(args, 'agentType')
      const agentModel = stringArg(args, 'agentModel')
      if (!request || !agentId || !agentType || !agentModel) {
        return agentInvalidParams('请同时上报 request、agentId、agentType 和 agentModel')
      }
      const result = manager.startExternalRequest(
        request,
        agentId,
        stringArg(args, 'projectId'),
        agentType,
        agentModel,
      )
      await options.activateWindow?.()
      return agentToolResponse({
        ok: true,
        summary: '已创建并领取外部剪辑任务',
        data: result,
      })
    }

    if (name === 'wait_for_edit_request') {
      const agentId = stringArg(args, 'agentId')
      const agentType = stringArg(args, 'agentType')
      const agentModel = stringArg(args, 'agentModel')
      if (!agentId || !agentType || !agentModel) {
        return agentInvalidParams('请同时上报 agentId、agentType 和 agentModel')
      }
      const result = await manager.waitForRequest(
        agentId,
        numberArg(args, 'timeoutSec'),
        agentType,
        agentModel,
      )
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
      ))
    }

    if (name === 'activate_luna_window') {
      await options.activateWindow?.()
      return agentToolResponse({ ok: true, summary: '已通知 Luna AI Cut 显示剪辑进度' })
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
    || name === 'create_media_contact_sheet'
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
    const taskResult = await handleAgentTaskTool(name, args, options, callId)
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

function httpToolPayload(rpcResponse: JsonRpcResponse): Record<string, unknown> {
  if (rpcResponse.error) {
    return {
      ok: false,
      summary: rpcResponse.error.message,
      error: {
        code: `RPC_${rpcResponse.error.code}`,
        message: rpcResponse.error.message,
      },
    }
  }

  const rpcResult = asRecord(rpcResponse.result)
  const structured = asRecord(rpcResult?.structuredContent)
  const content = Array.isArray(rpcResult?.content) ? rpcResult?.content : undefined
  if (!structured) {
    return {
      ok: false,
      summary: '工具返回了无效结果',
      ...(content ? { content } : {}),
    }
  }

  // The renderer bridge wraps its ToolResult in { ok, result }. HTTP callers
  // receive the ToolResult directly while retaining session metadata and images.
  const nested = asRecord(structured.result)
  const sessionContext = asRecord(asRecord(structured.data)?.lunaAgent)
  const payload = nested && typeof nested.ok === 'boolean'
    ? {
        ...nested,
        ...(sessionContext
          ? { data: { ...(asRecord(nested.data) ?? {}), lunaAgent: sessionContext } }
          : {}),
      }
    : { ...structured }
  return {
    ...payload,
    ...(content ? { content } : {}),
    ...(rpcResult?.isError === true ? { isError: true } : {}),
  }
}

function writeText(response: ServerResponse, status: number, value: string, contentType: string): void {
  response.statusCode = status
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', Buffer.byteLength(value))
  response.end(value)
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  baseUrl: string,
  options: LunaMcpServerOptions,
): Promise<void> {
  setCorsHeaders(response)
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }

  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && (pathname === '/' || pathname === '/.well-known/agent')) {
    writeJson(response, 200, {
      name: 'Luna AI Cut',
      agent: true,
      protocol: 'http',
      version: '1.0.0',
      baseUrl,
      skill: `${baseUrl}/skill.md`,
      tools: `${baseUrl}/tools`,
      openapi: `${baseUrl}/openapi.json`,
      api: `${baseUrl}/api/tools/{toolName}`,
    })
    return
  }

  if (request.method === 'GET' && pathname === '/skill.md') {
    response.setHeader('Cache-Control', 'no-store')
    writeText(response, 200, LUNA_HTTP_SKILL, 'text/markdown; charset=utf-8')
    return
  }

  if (request.method === 'GET' && (pathname === '/tools' || pathname === '/openapi.json')) {
    const catalog = await getToolCatalog(options)
    if (pathname === '/tools') {
      writeJson(response, 200, {
        ok: true,
        tools: catalog.tools,
        meta: {
          luna: {
            editorToolsReady: catalog.editorToolsReady,
            ...(catalog.message ? { message: catalog.message } : {}),
          },
        },
      })
    } else {
      writeJson(response, 200, openApiDocument(baseUrl, catalog))
    }
    return
  }

  if (request.method !== 'POST' || (pathname !== '/rpc' && !pathname.startsWith('/api/tools/'))) {
    writeJson(response, 404, { error: 'Not found' })
    return
  }
  try {
    const body = await readBody(request)
    const parsed = body.trim() ? JSON.parse(body) as unknown : {}
    if (pathname.startsWith('/api/tools/')) {
      const encodedName = pathname.slice('/api/tools/'.length)
      const name = decodeURIComponent(encodedName)
      if (!name || name.includes('/')) {
        writeJson(response, 404, { error: 'Tool not found' })
        return
      }
      const bodyRecord = asRecord(parsed) ?? {}
      const args = asRecord(bodyRecord.arguments) ?? bodyRecord
      const rpcResponse = await handleRpc({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      }, options)
      if (!rpcResponse) {
        response.statusCode = 204
        response.end()
        return
      }
      writeJson(response, 200, httpToolPayload(rpcResponse))
      return
    }
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
  let startPromise: Promise<LunaMcpEndpoint> | null = null
  let baseUrl = ''

  return {
    endpointPath,
    async start(): Promise<LunaMcpEndpoint> {
      if (server && endpoint) return endpoint
      if (startPromise) return startPromise

      startPromise = (async () => {
        server = createServer((request, response) => {
          void handleHttpRequest(request, response, baseUrl, options)
        })
        await new Promise<void>((resolve, reject) => {
          const current = server as Server
          current.once('error', reject)
          current.listen(0, '127.0.0.1', () => {
            current.off('error', reject)
            resolve()
          })
        })

        const address = server?.address()
        if (!address || typeof address === 'string') throw new Error('本机 Agent 服务启动失败')
        baseUrl = `http://127.0.0.1:${address.port}`
        endpoint = {
          version: 1,
          url: `${baseUrl}/rpc`,
          baseUrl,
          skillUrl: `${baseUrl}/skill.md`,
          toolsUrl: `${baseUrl}/tools`,
          openapiUrl: `${baseUrl}/openapi.json`,
          apiUrl: `${baseUrl}/api/tools/{toolName}`,
          pid: process.pid,
        }
        await mkdir(path.dirname(endpointPath), { recursive: true })
        await writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        return endpoint
      })()

      try {
        return await startPromise
      } catch (error) {
        startPromise = null
        const current = server
        server = null
        baseUrl = ''
        if (current) await new Promise<void>((resolve) => current.close(() => resolve()))
        throw error
      }
    },
    async getEndpoint(): Promise<LunaMcpEndpoint> {
      return await this.start()
    },
    async stop(): Promise<void> {
      const current = server
      server = null
      endpoint = null
      baseUrl = ''
      startPromise = null
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
