import { app } from 'electron'
import * as fs from 'node:fs/promises'
import path from 'node:path'

import type {
  AiEditingAssistantConfig,
  AiEditingAssistantConfigInput,
} from '../src/shared/types'

const CONFIG_FILE = 'ai-editing-assistant.json'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256 * 1024
const MIN_CONTEXT_WINDOW_TOKENS = 16 * 1024
const MAX_CONTEXT_WINDOW_TOKENS = 2 * 1024 * 1024

export interface StoredAssistantConfig {
  schemaVersion: 3
  baseUrl: string
  model: string
  contextWindowTokens: number
  apiKey?: string
  nativeToolCalling?: boolean
}

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function emptyConfig(): StoredAssistantConfig {
  return {
    schemaVersion: 3,
    baseUrl: DEFAULT_BASE_URL,
    model: '',
    contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
  }
}

function publicConfig(config: StoredAssistantConfig): AiEditingAssistantConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    contextWindowTokens: config.contextWindowTokens,
    hasApiKey: typeof config.apiKey === 'string' && config.apiKey.length > 0,
    nativeToolCalling: config.nativeToolCalling === true,
  }
}

export function normalizeBaseUrl(value: string): string {
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

export function normalizeModel(value: string): string {
  const model = value.trim()
  if (!model || model.length > 128 || /[\r\n]/.test(model)) {
    throw new Error('请输入有效的模型名称。')
  }
  return model
}

function normalizeApiKey(value: string): string {
  const apiKey = value.trim()
  if (!apiKey || apiKey.length > 1_024 || /[\r\n]/.test(apiKey)) {
    throw new Error('请输入有效的 API Key。')
  }
  return apiKey
}

function normalizeContextWindowTokens(value: unknown): number {
  if (!Number.isSafeInteger(value) ||
    (value as number) < MIN_CONTEXT_WINDOW_TOKENS ||
    (value as number) > MAX_CONTEXT_WINDOW_TOKENS) {
    throw new Error('模型记忆长度应在 16K 到 2048K 之间。')
  }
  return value as number
}

export async function readAssistantConfig(): Promise<StoredAssistantConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), 'utf8')) as Partial<StoredAssistantConfig>
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.model !== 'string') return emptyConfig()
    return {
      schemaVersion: 3,
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      model: parsed.model.trim(),
      contextWindowTokens: parsed.contextWindowTokens === undefined
        ? DEFAULT_CONTEXT_WINDOW_TOKENS
        : normalizeContextWindowTokens(parsed.contextWindowTokens),
      ...(typeof parsed.apiKey === 'string' && parsed.apiKey.trim()
        ? { apiKey: normalizeApiKey(parsed.apiKey) }
        : {}),
      ...(typeof parsed.nativeToolCalling === 'boolean'
        ? { nativeToolCalling: parsed.nativeToolCalling }
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
    await fs.writeFile(temporary, `${JSON.stringify(config)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await fs.rename(temporary, target)
    await fs.chmod(target, 0o600).catch(() => undefined)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

export function requireApiKey(config: StoredAssistantConfig): string {
  if (!config.apiKey) throw new Error('请先配置剪辑助手模型连接。')
  return config.apiKey
}

export async function getAiEditingAssistantConfig(): Promise<AiEditingAssistantConfig> {
  return publicConfig(await readAssistantConfig())
}

export async function saveAiEditingAssistantConfig(
  input: AiEditingAssistantConfigInput,
): Promise<AiEditingAssistantConfig> {
  const current = await readAssistantConfig()
  const next: StoredAssistantConfig = {
    schemaVersion: 3,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: normalizeModel(input.model),
    contextWindowTokens: normalizeContextWindowTokens(input.contextWindowTokens),
    nativeToolCalling: input.nativeToolCalling === true,
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

export async function saveNativeToolCallingCapability(
  nativeToolCalling: boolean,
): Promise<AiEditingAssistantConfig> {
  const current = await readAssistantConfig()
  const next = { ...current, nativeToolCalling }
  await writeConfig(next)
  return publicConfig(next)
}
