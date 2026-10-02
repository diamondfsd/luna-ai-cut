import type { LunaToolModule } from './lunaToolModule.ts'
import type { AiEditorMcpRequest, AiEditorMcpResponse, AiEditorMcpContent } from '../../src/shared/types/aiEditor.ts'
import type { GeneratedMusic, MusicTemplateDocument, MusicTemplateSummary } from '../features/music/musicGenerationService.ts'
import type { AgentSessionManager, AgentToolError } from './agentSessionManager.ts'
import type { DirectorPlanAgentService } from '../features/director-lab/directorPlanAgentService.ts'

export type RpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

export interface JsonRpcResponse {
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
  toolModules?: readonly LunaToolModule[]
  directorPlanTools?: DirectorPlanAgentService
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

export function isRpcId(value: unknown): value is RpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

export function jsonRpcError(id: RpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function textForResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function exportPathFromToolResult(value: unknown): string | null {
  const result = asRecord(value)
  if (result?.ok !== true) return null
  const data = asRecord(result.data)
  const exportPath = data?.path ?? data?.outputPath
  return typeof exportPath === 'string' && exportPath.trim() ? exportPath.trim() : null
}

export function agentToolErrorFromResult(value: unknown): AgentToolError | undefined {
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

export function contentForResponse(response: AiEditorMcpResponse): AiEditorMcpContent[] {
  if (response.content && response.content.length > 0) return [...response.content]
  return [{ type: 'text', text: textForResult(response.result) }]
}

export function contentWithAgentContext(
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

export function addAgentContext(result: unknown, manager?: AgentSessionManager): unknown {
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
