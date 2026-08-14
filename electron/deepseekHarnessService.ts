import { app, BrowserWindow, webContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { createAiEditingSourceGitService } from './aiEditingSourceGitService'
import { currentBaseDir } from './settingsService'
import type {
  EmbeddedDeepSeekHarnessConfig,
  EmbeddedDeepSeekHarnessConfigInput,
  EmbeddedDeepSeekHarnessConfigTestResult,
  EmbeddedDeepSeekHarnessSourceToolRequest,
  EmbeddedDeepSeekHarnessWebState,
} from '../packages/freecut-editor/src/shared/host/deepseek-harness'
import {
  getDeepSeekHarnessConfig,
  readDeepSeekHarnessConfig,
  requireDeepSeekHarnessApiKey,
  saveDeepSeekHarnessConfig,
  testDeepSeekHarnessConfig,
} from './deepseekHarnessConfig'

interface HarnessRuntime {
  projectId: string
  key: string
  process: ChildProcess
  token: string
  url: string
}

interface PendingSourceToolRequest {
  senderId: number
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

const listeners = new Set<(state: EmbeddedDeepSeekHarnessWebState) => void>()
const pendingSourceToolRequests = new Map<string, PendingSourceToolRequest>()
let runtime: HarnessRuntime | undefined
let startingRuntime: Promise<string> | undefined
let startingRuntimeGeneration: number | undefined
let startingChild: ChildProcess | undefined
let runtimeGeneration = 0
let rendererId: number | undefined
let sourceToolServer: Server | undefined
let sourceToolEndpoint: string | undefined

function appRoot(): string {
  return process.env.APP_ROOT ?? path.resolve(__dirname, '..')
}

function harnessRoot(): string {
  return path.join(appRoot(), 'packages/freecut-editor/src/features/ai-editing')
}

function packagedHarnessRoot(): string {
  return path.join(process.resourcesPath, 'deepseek-harness')
}

function cliEntry(): string {
  const candidates = [
    path.join(harnessRoot(), 'apps/cli/lib/bin.js'),
    path.join(appRoot(), 'dist/deepseek-harness/lib/bin.js'),
    path.join(packagedHarnessRoot(), 'lib/bin.js'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('DeepSeek Harness Web 运行时尚未构建，请重新启动应用。')
  return found
}

function standardPresetPath(): string {
  const candidates = [
    path.join(harnessRoot(), 'apps/cli/config/agent-presets/standard/agent.cordis.yml'),
    path.join(appRoot(), 'dist/deepseek-harness/config/agent-presets/standard/agent.cordis.yml'),
    path.join(packagedHarnessRoot(), 'config/agent-presets/standard/agent.cordis.yml'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('DeepSeek Harness 官方 Agent 预设缺失。')
  return found
}

function sourcePluginPath(): string {
  const candidates = [
    path.join(appRoot(), 'scripts/deepseek-harness-freecut-plugin.mjs'),
    path.join(appRoot(), 'dist/deepseek-harness/luna-freecut-plugin.mjs'),
    path.join(packagedHarnessRoot(), 'luna-freecut-plugin.mjs'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('Luna AI Cut 的 Harness 插件缺失。')
  return found
}

function harnessNodeExecutable(): string {
  const override = process.env.LUNA_HARNESS_NODE_PATH
  if (override && existsSync(override)) return override

  if (!app.isPackaged) {
    const pnpmNode = process.env.npm_node_execpath
    if (pnpmNode && existsSync(pnpmNode)) return pnpmNode
    // Electron 30 embeds Node 20, while the official Harness requires Node 22.
    return 'node'
  }

  const packagedNode = path.join(
    process.resourcesPath,
    'node-runtime',
    process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
  )
  if (existsSync(packagedNode)) return packagedNode
  throw new Error('当前安装包缺少 DeepSeek Harness 所需的 Node.js 22 运行时。')
}

function dshHome(): string {
  // Keep Harness history and credentials in the same private application data
  // directory as the FreeCut configuration, never in the project source tree.
  return path.join(app.getPath('userData'), 'deepseek-harness')
}

function projectSourceRoot(projectId: string): string {
  return createAiEditingSourceGitService(currentBaseDir(), projectId).rootPath
}

function emitState(state: EmbeddedDeepSeekHarnessWebState): void {
  for (const listener of listeners) listener(state)
}

function sourceToolTarget(): Electron.WebContents {
  if (rendererId !== undefined) {
    const target = webContents.fromId(rendererId)
    if (target && !target.isDestroyed()) return target
  }
  const target = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.webContents
  if (!target) throw new Error('当前没有可用的编辑器窗口。')
  return target
}

function requestSourceTool(
  projectId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const requestId = randomUUID()
  const target = sourceToolTarget()
  return new Promise((resolve, reject) => {
    pendingSourceToolRequests.set(requestId, { senderId: target.id, resolve, reject })
    try {
      target.send('deepseek-harness:source-tool-request', {
        requestId,
        projectId,
        name,
        args,
      } satisfies EmbeddedDeepSeekHarnessSourceToolRequest)
    } catch (error) {
      pendingSourceToolRequests.delete(requestId)
      reject(error)
    }
  })
}

function jsonResponse(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(body)
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as unknown as AsyncIterable<Buffer>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 2_000_000) throw new Error('源码工具请求过大。')
    chunks.push(buffer)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('源码工具请求格式无效。')
  return value as Record<string, unknown>
}

async function handleSourceToolRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    jsonResponse(response, 405, { ok: false, error: 'method not allowed' })
    return
  }
  if (request.headers.authorization !== `Bearer ${runtime?.token ?? ''}`) {
    jsonResponse(response, 401, { ok: false, error: 'unauthorized' })
    return
  }
  try {
    const body = await readRequestBody(request)
    const projectId = body.projectId
    const name = body.name
    const args = body.args
    if (typeof projectId !== 'string' || !projectId || typeof name !== 'string' || !name
      || !args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('源码工具请求参数无效。')
    }
    const result = await requestSourceTool(projectId, name, args as Record<string, unknown>)
    jsonResponse(response, 200, { ok: true, result })
  } catch (error) {
    jsonResponse(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : '源码工具调用失败。',
    })
  }
}

async function ensureSourceToolServer(): Promise<string> {
  if (sourceToolEndpoint) return sourceToolEndpoint
  sourceToolServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname !== '/source-tool') {
      jsonResponse(response, 404, { ok: false, error: 'not found' })
      return
    }
    void handleSourceToolRequest(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    sourceToolServer?.once('error', reject)
    sourceToolServer?.listen(0, '127.0.0.1', resolve)
  })
  const address = sourceToolServer.address()
  if (!address || typeof address === 'string') throw new Error('无法启动源码工具通道。')
  sourceToolEndpoint = `http://127.0.0.1:${String(address.port)}/source-tool`
  return sourceToolEndpoint
}

async function writePrivateDocument(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600).catch(() => undefined)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function readDocument(filePath: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = parse(await fs.readFile(filePath, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

async function ensureWebPatch(home: string): Promise<void> {
  const patchPath = path.join(home, 'cordis.patch.yml')
  let patches: unknown[] = []
  try {
    const value: unknown = parse(await fs.readFile(patchPath, 'utf8'))
    if (Array.isArray(value)) patches = value
  } catch {
    // The home patch is a generated deployment override. A malformed or
    // missing file should not prevent the embedded Web profile from starting.
  }
  const retained = patches.filter((entry) =>
    !entry || typeof entry !== 'object' || Array.isArray(entry) || (entry as Record<string, unknown>).id !== 'ui-jobs')
  retained.push({ id: 'ui-jobs', disabled: true })
  await writePrivateDocument(patchPath, retained)
}

async function prepareHarnessHome(config: Awaited<ReturnType<typeof readDeepSeekHarnessConfig>>, projectId: string, token: string, endpoint: string): Promise<void> {
  const home = dshHome()
  const settingsPath = path.join(home, 'settings.yaml')
  const currentSettings = await readDocument(settingsPath)
  currentSettings['llm-deepseek'] = {
    ...(currentSettings['llm-deepseek'] as Record<string, unknown> | undefined),
    baseURL: config.baseUrl,
    models: [{ id: config.model, name: config.model, contextWindow: config.contextWindowTokens }],
  }
  currentSettings['agent-default-model'] = { provider: 'deepseek-official', model: config.model }
  currentSettings['agent-presets'] = { default: 'luna-freecut' }
  await writePrivateDocument(settingsPath, currentSettings)
  await ensureWebPatch(home)
  await writePrivateDocument(path.join(home, '.credentials.yaml'), { DEEPSEEK_API_KEY: requireDeepSeekHarnessApiKey(config) })

  const presetDir = path.join(home, '.agent-presets', 'luna-freecut')
  await fs.mkdir(presetDir, { recursive: true, mode: 0o700 })
  const standard = await fs.readFile(standardPresetPath(), 'utf8')
  const pluginPath = sourcePluginPath().replaceAll('\\', '\\\\')
  const preset = `${standard.trimEnd()}\n\n- id: luna-freecut-source\n  name: ${JSON.stringify(pluginPath)}\n  config:\n    endpoint: ${JSON.stringify(endpoint)}\n    token: ${JSON.stringify(token)}\n    projectId: ${JSON.stringify(projectId)}\n\n`
  await fs.writeFile(path.join(presetDir, 'agent.cordis.yml'), preset, { encoding: 'utf8', mode: 0o600 })
  await fs.writeFile(path.join(presetDir, 'preset.yml'), 'name: Luna AI Cut\ndescription: 当前项目源码编辑能力\n', { encoding: 'utf8', mode: 0o600 })
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, 5_000)
    child.once('close', finish)
    child.kill()
  })
}

async function stopRuntime(): Promise<void> {
  runtimeGeneration += 1
  const current = runtime
  runtime = undefined
  startingRuntime = undefined
  startingRuntimeGeneration = undefined
  for (const pending of pendingSourceToolRequests.values()) pending.reject(new Error('DeepSeek Harness 已关闭。'))
  pendingSourceToolRequests.clear()
  const children = new Set<ChildProcess>()
  if (current) children.add(current.process)
  if (startingChild) children.add(startingChild)
  await Promise.all([...children].map((child) => terminateChild(child)))
}

async function startRuntime(projectId: string, generation: number): Promise<string> {
  const config = await readDeepSeekHarnessConfig()
  const apiKey = requireDeepSeekHarnessApiKey(config)
  const endpoint = await ensureSourceToolServer()
  const token = randomUUID()
  await prepareHarnessHome({ ...config, apiKey }, projectId, token, endpoint)
  if (generation !== runtimeGeneration) throw new Error('DeepSeek Harness Web 启动已取消。')
  const cwd = projectSourceRoot(projectId)
  const child = spawn(harnessNodeExecutable(), [cliEntry(), 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd,
    env: {
      ...process.env,
      DSH_HOME: dshHome(),
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  startingChild = child
  let output = ''
  let resolveUrl: ((url: string) => void) | undefined
  let rejectUrl: ((error: Error) => void) | undefined
  const urlPromise = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve
    rejectUrl = reject
  })
  const fail = (error: Error) => rejectUrl?.(error)
  const consume = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-64_000)
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
    if (match?.[1]) resolveUrl?.(match[1])
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  child.once('error', fail)
  child.once('close', (code) => {
    if (code !== 0) fail(new Error(`DeepSeek Harness Web 已退出（${String(code ?? '未知错误')}）。`))
  })
  emitState({ projectId, status: 'starting' })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const url = await Promise.race([
      urlPromise,
      new Promise<string>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('DeepSeek Harness Web 启动超时。')), 30_000)
      }),
    ])
    if (generation !== runtimeGeneration) {
      await terminateChild(child)
      throw new Error('DeepSeek Harness Web 启动已取消。')
    }
    runtime = { projectId, key: `${projectId}\u0000${config.baseUrl}\u0000${config.model}\u0000${config.contextWindowTokens}`, process: child, token, url }
    child.once('close', () => {
      if (runtime?.process === child) {
        runtime = undefined
        emitState({ projectId, status: 'error', error: 'DeepSeek Harness Web 已停止。' })
      }
    })
    emitState({ projectId, status: 'ready', url })
    return url
  } catch (error) {
    await terminateChild(child)
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    if (timeout) clearTimeout(timeout)
    if (startingChild === child) startingChild = undefined
  }
}

export function setDeepSeekHarnessRenderer(senderId: number): void {
  rendererId = senderId
}

export function resolveDeepSeekHarnessSourceToolResponse(
  senderId: number,
  payload: { requestId: string; ok: boolean; result?: unknown; error?: string },
): void {
  const pending = pendingSourceToolRequests.get(payload.requestId)
  if (!pending || pending.senderId !== senderId) return
  pendingSourceToolRequests.delete(payload.requestId)
  if (payload.ok) pending.resolve(payload.result)
  else pending.reject(new Error(payload.error || '源码工具调用失败。'))
}

export async function getDeepSeekHarnessPublicConfig(): Promise<EmbeddedDeepSeekHarnessConfig> {
  return getDeepSeekHarnessConfig()
}

export async function saveDeepSeekHarnessPublicConfig(
  input: EmbeddedDeepSeekHarnessConfigInput,
): Promise<EmbeddedDeepSeekHarnessConfig> {
  const result = await saveDeepSeekHarnessConfig(input)
  await stopRuntime()
  return result
}

export function testDeepSeekHarnessPublicConfig(
  input: EmbeddedDeepSeekHarnessConfigInput,
): Promise<EmbeddedDeepSeekHarnessConfigTestResult> {
  return testDeepSeekHarnessConfig(input)
}

export async function getDeepSeekHarnessWebUrl(projectId: string): Promise<string> {
  const config = await readDeepSeekHarnessConfig()
  requireDeepSeekHarnessApiKey(config)
  const key = `${projectId}\u0000${config.baseUrl}\u0000${config.model}\u0000${config.contextWindowTokens}`
  if (runtime?.key === key && runtime.process.exitCode === null) return runtime.url
  await stopRuntime()
  if (!startingRuntime) {
    const generation = runtimeGeneration
    startingRuntimeGeneration = generation
    const pending = startRuntime(projectId, generation)
    startingRuntime = pending.finally(() => {
      if (startingRuntimeGeneration === generation) {
        startingRuntime = undefined
        startingRuntimeGeneration = undefined
      }
    })
  }
  return startingRuntime
}

export function onDeepSeekHarnessWebState(listener: (state: EmbeddedDeepSeekHarnessWebState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function disposeDeepSeekHarness(): Promise<void> {
  await stopRuntime()
  if (sourceToolServer) {
    await new Promise<void>((resolve) => sourceToolServer?.close(() => resolve()))
    sourceToolServer = undefined
    sourceToolEndpoint = undefined
  }
  rendererId = undefined
}
