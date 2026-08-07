import { app, safeStorage } from 'electron'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'

import type {
  AiEditingAssistantConfig,
  AiEditingAssistantConfigInput,
  AiEditingAssistantGenerateInput,
} from '../src/shared/types'

const CONFIG_FILE = 'ai-editing-assistant.json'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_MESSAGE_COUNT = 20
const MAX_MESSAGE_LENGTH = 100_000
const activeRequests = new Map<string, AbortController>()

interface StoredAssistantConfig {
  schemaVersion: 1
  baseUrl: string
  model: string
  encryptedApiKey?: string
}

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function emptyConfig(): StoredAssistantConfig {
  return { schemaVersion: 1, baseUrl: DEFAULT_BASE_URL, model: '' }
}

function publicConfig(config: StoredAssistantConfig): AiEditingAssistantConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: typeof config.encryptedApiKey === 'string' && config.encryptedApiKey.length > 0,
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
    if (parsed.schemaVersion !== 1 || typeof parsed.baseUrl !== 'string' || typeof parsed.model !== 'string') {
      return emptyConfig()
    }
    return {
      schemaVersion: 1,
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      model: parsed.model.trim(),
      ...(typeof parsed.encryptedApiKey === 'string' ? { encryptedApiKey: parsed.encryptedApiKey } : {}),
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

function decryptApiKey(config: StoredAssistantConfig): string {
  if (!config.encryptedApiKey) throw new Error('请先配置剪辑助手模型连接。')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，无法读取 API Key。')
  try {
    return safeStorage.decryptString(Buffer.from(config.encryptedApiKey, 'base64'))
  } catch {
    throw new Error('已保存的 API Key 无法读取，请重新保存。')
  }
}

function validateGenerateInput(input: AiEditingAssistantGenerateInput): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) throw new Error('请求无效，请重试。')
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_MESSAGE_COUNT) {
    throw new Error('剪辑助手上下文无效，请重新发起请求。')
  }
  for (const message of input.messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error('剪辑助手上下文无效，请重新发起请求。')
    }
  }
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

export async function getAiEditingAssistantConfig(): Promise<AiEditingAssistantConfig> {
  return publicConfig(await readConfig())
}

export async function saveAiEditingAssistantConfig(input: AiEditingAssistantConfigInput): Promise<AiEditingAssistantConfig> {
  const current = await readConfig()
  const next: StoredAssistantConfig = {
    schemaVersion: 1,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: normalizeModel(input.model),
  }

  if (input.clearApiKey) {
    if (input.apiKey?.trim()) throw new Error('请只选择保存新的 API Key 或清除已保存的 API Key。')
  } else if (input.apiKey !== undefined) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，无法保存 API Key。')
    next.encryptedApiKey = safeStorage.encryptString(normalizeApiKey(input.apiKey)).toString('base64')
  } else if (current.encryptedApiKey) {
    next.encryptedApiKey = current.encryptedApiKey
  }

  await writeConfig(next)
  return publicConfig(next)
}

export async function generateAiEditingAssistantResponse(input: AiEditingAssistantGenerateInput): Promise<string> {
  validateGenerateInput(input)
  if (activeRequests.has(input.requestId)) throw new Error('剪辑助手正在处理这个请求。')

  const config = await readConfig()
  const apiKey = decryptApiKey(config)
  const model = normalizeModel(config.model)
  const controller = new AbortController()
  activeRequests.set(input.requestId, controller)
  try {
    const client = new OpenAI({ apiKey, baseURL: normalizeBaseUrl(config.baseUrl) })
    const response = await client.chat.completions.create({
      model,
      messages: input.messages.map((message) => {
        if (message.role === 'system') return { role: 'system' as const, content: message.content }
        if (message.role === 'assistant') return { role: 'assistant' as const, content: message.content }
        return { role: 'user' as const, content: message.content }
      }),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    }, { signal: controller.signal })
    const text = response.choices[0]?.message.content?.trim()
    if (!text) throw new Error('剪辑助手没有返回内容，请重试。')
    return text
  } catch (error) {
    if (error instanceof Error && error.message === '剪辑助手没有返回内容，请重试。') throw error
    throw connectionError(error, controller)
  } finally {
    activeRequests.delete(input.requestId)
  }
}

export function cancelAiEditingAssistantRequest(requestId: string): void {
  activeRequests.get(requestId)?.abort()
}
