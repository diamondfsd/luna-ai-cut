import { app } from 'electron'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

import type {
  AiEditingAssistantConfig,
  AiEditingAssistantConfigInput,
  AiEditingAssistantGenerateInput,
  AiEditingAssistantGenerateResult,
  AiEditingAssistantMessage,
  AiEditingAssistantToolCall,
} from '../src/shared/types'

const CONFIG_FILE = 'ai-editing-assistant.json'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_MESSAGE_COUNT = 48
const MAX_MESSAGE_LENGTH = 100_000
const MAX_TOTAL_MESSAGE_LENGTH = 500_000
const MAX_TOOL_COUNT = 48
const MAX_TOOL_DESCRIPTION_LENGTH = 8_000
const MAX_TOOL_SCHEMA_LENGTH = 32_000
const MAX_TOOL_ARGUMENT_LENGTH = 50_000
const MAX_TOOL_CALLS_PER_MESSAGE = 3
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/
const TOOL_CALL_ID_PATTERN = /^[\x21-\x7E]{1,256}$/
const activeRequests = new Map<string, AbortController>()

interface StoredAssistantConfig {
  schemaVersion: 2
  baseUrl: string
  model: string
  apiKey?: string
}

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function emptyConfig(): StoredAssistantConfig {
  return { schemaVersion: 2, baseUrl: DEFAULT_BASE_URL, model: '' }
}

function publicConfig(config: StoredAssistantConfig): AiEditingAssistantConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: typeof config.apiKey === 'string' && config.apiKey.length > 0,
  }
}

function normalizeBaseUrl(value: string): string {
  const raw = value.trim()
  if (!raw || raw.length > 500) throw new Error('请输入有效的服务地址。')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('请输入有效的服务地址。')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址不能包含账号、查询参数或片段。')
  }
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw new Error('服务地址需要使用 HTTPS；本机服务可使用 HTTP。')
  }
  return url.toString().replace(/\/+$/, '')
}

function normalizeModel(value: string): string {
  const model = value.trim()
  if (!model || model.length > 128 || /[\r\n]/.test(model)) throw new Error('请输入有效的模型名称。')
  return model
}

function normalizeApiKey(value: string): string {
  const apiKey = value.trim()
  if (!apiKey || apiKey.length > 1_024 || /[\r\n]/.test(apiKey)) throw new Error('请输入有效的 API Key。')
  return apiKey
}

async function readConfig(): Promise<StoredAssistantConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), 'utf8')) as Partial<StoredAssistantConfig>
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.model !== 'string') {
      return emptyConfig()
    }
    return {
      schemaVersion: 2,
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      model: parsed.model.trim(),
      ...(typeof parsed.apiKey === 'string' && parsed.apiKey.trim()
        ? { apiKey: normalizeApiKey(parsed.apiKey) }
        : {}),
    }
  } catch {
    return emptyConfig()
  }
}

async function writeConfig(config: StoredAssistantConfig): Promise<void> {
  const target = configPath()
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.writeFile(temporary, `${JSON.stringify(config)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, target)
    await fs.chmod(target, 0o600).catch(() => undefined)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

function requireApiKey(config: StoredAssistantConfig): string {
  if (!config.apiKey) throw new Error('请先配置剪辑助手模型连接。')
  return config.apiKey
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function serializedJsonLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized.length : null
  } catch {
    return null
  }
}

function isToolCallId(value: unknown): value is string {
  return typeof value === 'string' && TOOL_CALL_ID_PATTERN.test(value)
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && TOOL_NAME_PATTERN.test(value)
}

function responseError(message: string): Error {
  const error = new Error(message)
  error.name = 'AiEditingAssistantResponseError'
  return error
}

function validateToolCall(value: unknown): value is AiEditingAssistantToolCall {
  return isRecord(value)
    && isToolCallId(value.id)
    && isToolName(value.name)
    && typeof value.arguments === 'string'
    && value.arguments.length <= MAX_TOOL_ARGUMENT_LENGTH
}

function validateTools(input: AiEditingAssistantGenerateInput): void {
  if (input.tools === undefined) return
  if (!Array.isArray(input.tools) || input.tools.length > MAX_TOOL_COUNT) {
    throw new Error('剪辑助手工具配置无效，请重试。')
  }
  const names = new Set<string>()
  for (const tool of input.tools) {
    const schemaLength = serializedJsonLength(tool?.parameters)
    if (!tool || !isToolName(tool.name) || names.has(tool.name)
      || typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > MAX_TOOL_DESCRIPTION_LENGTH
      || !isRecord(tool.parameters) || tool.parameters.type !== 'object' || !isRecord(tool.parameters.properties)
      || schemaLength === null || schemaLength > MAX_TOOL_SCHEMA_LENGTH) {
      throw new Error('剪辑助手工具配置无效，请重试。')
    }
    if (tool.parameters.required !== undefined
      && (!Array.isArray(tool.parameters.required)
        || tool.parameters.required.some((name) => typeof name !== 'string' || !name || name.length > 256))) {
      throw new Error('剪辑助手工具配置无效，请重试。')
    }
    names.add(tool.name)
  }
}

function validateGenerateInput(input: AiEditingAssistantGenerateInput): void {
  if (!input || typeof input !== 'object') throw new Error('请求无效，请重试。')
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) throw new Error('请求无效，请重试。')
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_MESSAGE_COUNT) {
    throw new Error('剪辑助手上下文无效，请重新发起请求。')
  }
  let totalLength = 0
  const pendingToolCallIds = new Set<string>()
  for (const message of input.messages) {
    if (!isRecord(message) || typeof message.role !== 'string') throw new Error('剪辑助手上下文无效，请重新发起请求。')
    if (message.role === 'tool') {
      if (!isToolCallId(message.toolCallId) || !pendingToolCallIds.delete(message.toolCallId)
        || typeof message.content !== 'string' || !message.content.trim() || message.content.length > MAX_MESSAGE_LENGTH) {
        throw new Error('剪辑助手上下文无效，请重新发起请求。')
      }
      totalLength += message.content.length
      continue
    }
    if (pendingToolCallIds.size > 0) throw new Error('剪辑助手上下文无效，请重新发起请求。')
    if (message.role === 'assistant') {
      const contentValid = message.content === undefined
        || (typeof message.content === 'string' && message.content.length <= MAX_MESSAGE_LENGTH)
      const toolCalls = message.toolCalls
      if (!contentValid || (toolCalls !== undefined && !Array.isArray(toolCalls))
        || (!message.content?.trim() && (!Array.isArray(toolCalls) || toolCalls.length === 0))
        || (Array.isArray(toolCalls) && (toolCalls.length === 0 || toolCalls.length > MAX_TOOL_CALLS_PER_MESSAGE))) {
        throw new Error('剪辑助手上下文无效，请重新发起请求。')
      }
      if (typeof message.content === 'string') totalLength += message.content.length
      for (const toolCall of toolCalls ?? []) {
        if (!validateToolCall(toolCall) || pendingToolCallIds.has(toolCall.id)) {
          throw new Error('剪辑助手上下文无效，请重新发起请求。')
        }
        pendingToolCallIds.add(toolCall.id)
        totalLength += toolCall.arguments.length
      }
      continue
    }
    if (!['system', 'user'].includes(message.role) || typeof message.content !== 'string'
      || !message.content.trim() || message.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error('剪辑助手上下文无效，请重新发起请求。')
    }
    totalLength += message.content.length
  }
  if (pendingToolCallIds.size > 0 || totalLength > MAX_TOTAL_MESSAGE_LENGTH) {
    throw new Error('剪辑助手上下文无效，请重新发起请求。')
  }
  if (input.mode !== undefined && input.mode !== 'auto' && input.mode !== 'json') {
    throw new Error('生成参数无效，请重试。')
  }
  validateTools(input)
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 64 || input.maxTokens > 4_096) {
    throw new Error('生成长度无效，请重试。')
  }
  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
    throw new Error('生成参数无效，请重试。')
  }
}

function connectionError(error: unknown, controller: AbortController): Error {
  if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
    return new DOMException('Aborted', 'AbortError')
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 404) {
      return new Error('剪辑助手连接失败：服务地址不支持 Chat Completions。请填写服务根地址，不要包含 /chat/completions。')
    }
    return new Error(`剪辑助手连接失败（服务返回 ${error.status}）。请检查服务地址、模型和 API Key。`)
  }
  return new Error('无法连接剪辑助手，请检查网络和服务地址。')
}

function doesNotSupportJsonMode(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError) || error.status !== 400) return false
  return /response_format|json[_ -]?object|json mode/i.test(error.message)
}

function doesNotSupportToolCalling(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError) || ![400, 404, 422].includes(error.status)) return false
  return /(?:tools?|tool_choice|function calling|function_call).*(?:unsupported|not supported|unknown|unrecognized|invalid parameter|not allowed)|(?:unsupported|not supported|unknown|unrecognized|invalid parameter|not allowed).*(?:tools?|tool_choice|function calling|function_call)/i.test(error.message)
}

function toChatMessages(messages: AiEditingAssistantMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content?.trim() || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: { name: toolCall.name, arguments: toolCall.arguments },
              })),
            }
          : {}),
      }
    }
    return { role: message.role, content: message.content }
  })
}

function toChatTools(input: AiEditingAssistantGenerateInput): ChatCompletionTool[] {
  return (input.tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function extractJsonResult(response: OpenAI.Chat.Completions.ChatCompletion): AiEditingAssistantGenerateResult {
  const content = response.choices[0]?.message.content?.trim()
  if (!content) throw responseError('剪辑助手没有返回内容，请重试。')
  return { mode: 'json', content, toolCalls: [] }
}

function extractToolResult(response: OpenAI.Chat.Completions.ChatCompletion): AiEditingAssistantGenerateResult {
  const message = response.choices[0]?.message
  const content = typeof message?.content === 'string' ? message.content.trim() : ''
  const rawToolCalls = message?.tool_calls ?? []
  if (rawToolCalls.length > MAX_TOOL_CALLS_PER_MESSAGE) {
    throw responseError('剪辑助手一次请求的操作过多，请重试。')
  }
  const toolCalls = rawToolCalls.map((toolCall) => {
    if (toolCall.type !== 'function' || !validateToolCall({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    })) {
      throw responseError('剪辑助手返回的工具调用格式无效，请重试。')
    }
    return { id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }
  })
  if (!content && toolCalls.length === 0) throw responseError('剪辑助手没有返回内容，请重试。')
  return { mode: 'tools', content, toolCalls }
}

export async function getAiEditingAssistantConfig(): Promise<AiEditingAssistantConfig> {
  return publicConfig(await readConfig())
}

export async function saveAiEditingAssistantConfig(input: AiEditingAssistantConfigInput): Promise<AiEditingAssistantConfig> {
  const current = await readConfig()
  const next: StoredAssistantConfig = {
    schemaVersion: 2,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: normalizeModel(input.model),
  }

  if (input.clearApiKey) {
    if (input.apiKey?.trim()) throw new Error('请只选择保存新的 API Key 或清除已保存的 API Key。')
  } else if (input.apiKey !== undefined) {
    next.apiKey = normalizeApiKey(input.apiKey)
  } else if (current.apiKey) {
    next.apiKey = current.apiKey
  }

  await writeConfig(next)
  return publicConfig(next)
}

export async function generateAiEditingAssistantResponse(input: AiEditingAssistantGenerateInput): Promise<AiEditingAssistantGenerateResult> {
  validateGenerateInput(input)
  if (activeRequests.has(input.requestId)) throw new Error('剪辑助手正在处理这个请求。')

  const config = await readConfig()
  const apiKey = requireApiKey(config)
  const model = normalizeModel(config.model)
  const controller = new AbortController()
  activeRequests.set(input.requestId, controller)
  try {
    const client = new OpenAI({ apiKey, baseURL: normalizeBaseUrl(config.baseUrl) })
    const request = {
      model,
      messages: toChatMessages(input.messages),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    }
    const mode = input.mode ?? 'auto'
    const tools = toChatTools(input)

    if (mode === 'auto' && tools.length > 0) {
      try {
        const response = await client.chat.completions.create({
          ...request,
          tools,
          tool_choice: 'auto',
        }, { signal: controller.signal })
        return extractToolResult(response)
      } catch (error) {
        if (!doesNotSupportToolCalling(error)) throw error
        return { mode: 'fallback', content: '', toolCalls: [] }
      }
    }

    let response
    try {
      response = await client.chat.completions.create({
        ...request,
        response_format: { type: 'json_object' },
      }, { signal: controller.signal })
    } catch (error) {
      if (!doesNotSupportJsonMode(error)) throw error
      response = await client.chat.completions.create(request, { signal: controller.signal })
    }
    return extractJsonResult(response)
  } catch (error) {
    if (error instanceof Error && error.name === 'AiEditingAssistantResponseError') throw error
    throw connectionError(error, controller)
  } finally {
    activeRequests.delete(input.requestId)
  }
}

export function cancelAiEditingAssistantRequest(requestId: string): void {
  activeRequests.get(requestId)?.abort()
}
