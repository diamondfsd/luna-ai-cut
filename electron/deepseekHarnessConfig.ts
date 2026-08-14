import { app } from 'electron'
import * as fs from 'node:fs/promises'
import path from 'node:path'

import type {
  EmbeddedDeepSeekHarnessConfig,
  EmbeddedDeepSeekHarnessConfigInput,
  EmbeddedDeepSeekHarnessConfigTestResult,
} from '../packages/freecut-editor/src/shared/host/deepseek-harness'

const CONFIG_FILE = 'deepseek-harness.json'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_CONTEXT_WINDOW_TOKENS = 262_144
const DEFAULT_MAX_OUTPUT_TOKENS = 131_072
const MIN_CONTEXT_WINDOW_TOKENS = 16_384
const MAX_CONTEXT_WINDOW_TOKENS = 2_097_152
const MIN_MAX_OUTPUT_TOKENS = 1
const MAX_MAX_OUTPUT_TOKENS = 131_072

interface StoredConfig {
  schemaVersion: 1
  baseUrl: string
  model: string
  contextWindowTokens: number
  maxOutputTokens: number
  apiKey?: string
}

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function emptyConfig(): StoredConfig {
  return {
    schemaVersion: 1,
    baseUrl: DEFAULT_BASE_URL,
    model: '',
    contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  }
}

function publicConfig(config: StoredConfig): EmbeddedDeepSeekHarnessConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    contextWindowTokens: config.contextWindowTokens,
    maxOutputTokens: config.maxOutputTokens,
    hasApiKey: Boolean(config.apiKey),
  }
}

export function normalizeHarnessBaseUrl(value: string): string {
  const raw = value.trim()
  if (!raw || raw.length > 500) throw new Error('请输入有效的服务地址。')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('请输入有效的服务地址。')
  }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw new Error('服务地址需要使用 HTTPS；本机服务可使用 HTTP。')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址不能包含账号、查询参数或片段。')
  }
  return url.toString().replace(/\/+$/, '')
}

function normalizeModel(value: string): string {
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
  if (!Number.isSafeInteger(value)
    || (value as number) < MIN_CONTEXT_WINDOW_TOKENS
    || (value as number) > MAX_CONTEXT_WINDOW_TOKENS) {
    throw new Error('模型记忆长度应在 16K 到 2048K 之间。')
  }
  return value as number
}

function normalizeMaxOutputTokens(value: unknown): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < MIN_MAX_OUTPUT_TOKENS
    || (value as number) > MAX_MAX_OUTPUT_TOKENS) {
    throw new Error('单次输出长度应在 1 到 131072 之间。')
  }
  return value as number
}

export async function readDeepSeekHarnessConfig(): Promise<StoredConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), 'utf8')) as Partial<StoredConfig>
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.model !== 'string') return emptyConfig()
    return {
      schemaVersion: 1,
      baseUrl: normalizeHarnessBaseUrl(parsed.baseUrl),
      model: parsed.model.trim(),
      contextWindowTokens: parsed.contextWindowTokens === undefined
        ? DEFAULT_CONTEXT_WINDOW_TOKENS
        : normalizeContextWindowTokens(parsed.contextWindowTokens),
      maxOutputTokens: parsed.maxOutputTokens === undefined
        ? DEFAULT_MAX_OUTPUT_TOKENS
        : normalizeMaxOutputTokens(parsed.maxOutputTokens),
      ...(typeof parsed.apiKey === 'string' && parsed.apiKey.trim()
        ? { apiKey: normalizeApiKey(parsed.apiKey) }
        : {}),
    }
  } catch {
    return emptyConfig()
  }
}

async function writeConfig(config: StoredConfig): Promise<void> {
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

export async function getDeepSeekHarnessConfig(): Promise<EmbeddedDeepSeekHarnessConfig> {
  return publicConfig(await readDeepSeekHarnessConfig())
}

export async function saveDeepSeekHarnessConfig(
  input: EmbeddedDeepSeekHarnessConfigInput,
): Promise<EmbeddedDeepSeekHarnessConfig> {
  const current = await readDeepSeekHarnessConfig()
  const next: StoredConfig = {
    schemaVersion: 1,
    baseUrl: normalizeHarnessBaseUrl(input.baseUrl),
    model: normalizeModel(input.model),
    contextWindowTokens: normalizeContextWindowTokens(input.contextWindowTokens),
    maxOutputTokens: normalizeMaxOutputTokens(input.maxOutputTokens),
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

export async function testDeepSeekHarnessConfig(
  input: EmbeddedDeepSeekHarnessConfigInput,
): Promise<EmbeddedDeepSeekHarnessConfigTestResult> {
  const current = await readDeepSeekHarnessConfig()
  const baseUrl = normalizeHarnessBaseUrl(input.baseUrl)
  const model = normalizeModel(input.model)
  const contextWindowTokens = normalizeContextWindowTokens(input.contextWindowTokens)
  const maxOutputTokens = normalizeMaxOutputTokens(input.maxOutputTokens)
  const apiKey = input.apiKey === undefined ? current.apiKey : normalizeApiKey(input.apiKey)
  const config = publicConfig({ schemaVersion: 1, baseUrl, model, contextWindowTokens, maxOutputTokens, ...(apiKey ? { apiKey } : {}) })
  if (!apiKey) return { config, connected: false, message: '请先填写 API Key。' }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return { config, connected: false, message: `服务返回了 ${response.status}，请检查地址和密钥。` }
    return { config, connected: true, message: '连接成功。' }
  } catch (error) {
    return { config, connected: false, message: error instanceof Error ? error.message : '连接失败，请检查网络。' }
  }
}

export function requireDeepSeekHarnessApiKey(config: StoredConfig): string {
  if (!config.apiKey) throw new Error('请先配置 DeepSeek Harness 的 API Key。')
  return config.apiKey
}
