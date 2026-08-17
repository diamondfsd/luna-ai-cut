import { app, BrowserWindow, webContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { createAiEditingSourceGitService } from './aiEditingSourceGitService'
import { withEmbeddedHarnessDefaults } from './deepseekHarnessDefaults'
import { currentBaseDir } from './settingsService'
import { createUserMemoryStore } from './userMemoryService'
import type {
  EmbeddedDeepSeekHarnessSourceToolRequest,
  EmbeddedDeepSeekHarnessWebState,
} from '../packages/freecut-editor/src/shared/host/deepseek-harness'

const DEFAULT_HARNESS_MODEL = 'deepseek-v4-flash'

interface HarnessRuntime {
  projectId: string
  key: string
  home: string
  process: ChildProcess
  token: string
  url: string
}

interface PendingSourceToolRequest {
  senderId: number
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

const SOURCE_TOOL_REQUEST_TIMEOUT_MS = 130_000

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
let userMemoryStore: ReturnType<typeof createUserMemoryStore> | undefined

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

function harnessHomeForBaseDir(baseDir: string): string {
  return path.join(baseDir, 'deepseek-harness')
}

function harnessSessionRootForBaseDir(baseDir: string): string {
  return path.join(harnessHomeForBaseDir(baseDir), 'sessions')
}

function dshHome(): string {
  // Keep Harness settings, credentials, and session indexes beside the rest of
  // the user's configured local data, never in the project source tree.
  return harnessHomeForBaseDir(currentBaseDir())
}

function userMemoryRoot(): string {
  // User preferences are private application data and must never live in a
  // project source worktree. They apply across all Luna AI Cut projects.
  return path.join(app.getPath('userData'), 'user-memory')
}

async function executeUserMemoryTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  userMemoryStore ??= createUserMemoryStore(userMemoryRoot())
  const store = userMemoryStore
  switch (name) {
    case 'memory.read':
      return store.read(args as unknown as Parameters<typeof store.read>[0])
    case 'memory.search':
      return store.search(args as unknown as Parameters<typeof store.search>[0])
    case 'memory.update':
      return store.update(args as unknown as Parameters<typeof store.update>[0])
    case 'memory.remove':
      return store.remove(args as unknown as Parameters<typeof store.remove>[0])
    default:
      throw new Error(`未知的用户记忆能力：${name}`)
  }
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
  requestId: string,
): Promise<unknown> {
  const target = sourceToolTarget()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cancelDeepSeekHarnessSourceToolRequest(target.id, requestId, '源码工具调用超时。')
    }, SOURCE_TOOL_REQUEST_TIMEOUT_MS)
    pendingSourceToolRequests.set(requestId, { senderId: target.id, resolve, reject, timeout })
    try {
      target.send('deepseek-harness:source-tool-request', {
        requestId,
        projectId,
        name,
        args,
      } satisfies EmbeddedDeepSeekHarnessSourceToolRequest)
    } catch (error) {
      clearTimeout(timeout)
      pendingSourceToolRequests.delete(requestId)
      reject(error)
    }
  })
}

function jsonResponse(response: ServerResponse, status: number, payload: unknown): void {
  if (response.destroyed || response.writableEnded) return
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
    const requestId = body.requestId
    const projectId = body.projectId
    const name = body.name
    const args = body.args
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128
      || typeof projectId !== 'string' || !projectId || typeof name !== 'string' || !name
      || !args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('源码工具请求参数无效。')
    }
    let cancelled = false
    const cancel = (): void => {
      if (cancelled || response.writableEnded) return
      cancelled = true
      cancelDeepSeekHarnessSourceToolRequest(undefined, requestId, '源码工具调用已取消。')
    }
    request.once('aborted', cancel)
    response.once('close', cancel)
    try {
      const result = name.startsWith('memory.')
        ? await executeUserMemoryTool(name, args as Record<string, unknown>)
        : await requestSourceTool(projectId, name, args as Record<string, unknown>, requestId)
      jsonResponse(response, 200, { ok: true, result })
    } finally {
      request.removeListener('aborted', cancel)
      response.removeListener('close', cancel)
    }
  } catch (error) {
    if (response.destroyed || response.writableEnded) return
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

function configuredAgentModel(settings: Record<string, unknown>): string {
  const selection = settings['agent-default-model']
  if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
    const model = (selection as Record<string, unknown>).model
    if (typeof model === 'string' && model.trim()) return model.trim()
  }
  return DEFAULT_HARNESS_MODEL
}

async function ensureWebPatch(home: string, config: {
  cwd: string
  endpoint: string
  token: string
  projectId: string
  model: string
}): Promise<void> {
  const patchPath = path.join(home, 'cordis.patch.yml')
  let patches: unknown[] = []
  try {
    const value: unknown = parse(await fs.readFile(patchPath, 'utf8'))
    if (Array.isArray(value)) patches = value
  } catch {
    // The home patch is a generated deployment override. A malformed or
    // missing file should not prevent the embedded Web profile from starting.
  }
  const retained = patches.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true
    const record = entry as Record<string, unknown>
    if (record.id === 'ui-jobs' || record.id === 'luna-freecut') return false
    const inserted = record.insert
    return !Array.isArray(inserted) || !inserted.some((row) =>
      row && typeof row === 'object' && !Array.isArray(row) && (row as Record<string, unknown>).id === 'luna-freecut')
  })
  retained.push({ id: 'ui-jobs', disabled: true })
  retained.push({
    insert: [{
      id: 'luna-freecut',
      name: sourcePluginPath().replaceAll('\\', '\\\\'),
      config: {
        ...config,
      },
    }],
  })
  await writePrivateDocument(patchPath, retained)
}

async function prepareHarnessHome(
  projectId: string,
  token: string,
  endpoint: string,
  cwd: string,
  home: string,
): Promise<void> {
  const settingsPath = path.join(home, 'settings.yaml')
  const currentSettings = withEmbeddedHarnessDefaults(await readDocument(settingsPath))
  const existingPresets = currentSettings['agent-presets']
  currentSettings['agent-presets'] = {
    ...(existingPresets && typeof existingPresets === 'object' && !Array.isArray(existingPresets) ? existingPresets : {}),
    default: 'luna-freecut',
  }
  const existingTheme = currentSettings['ui-theme']
  const existingPreference = existingTheme && typeof existingTheme === 'object' && !Array.isArray(existingTheme)
    ? (existingTheme as Record<string, unknown>).preference
    : undefined
  currentSettings['ui-theme'] = {
    ...(existingTheme && typeof existingTheme === 'object' && !Array.isArray(existingTheme) ? existingTheme : {}),
    preference: existingPreference === 'light' || existingPreference === 'dark' || existingPreference === 'system'
      ? existingPreference
      : 'dark',
  }
  await writePrivateDocument(settingsPath, currentSettings)
  await ensureWebPatch(home, { cwd, endpoint, token, projectId, model: configuredAgentModel(currentSettings) })

  const presetDir = path.join(home, '.agent-presets', 'luna-freecut')
  await fs.mkdir(presetDir, { recursive: true, mode: 0o700 })
  const standard = await fs.readFile(standardPresetPath(), 'utf8')
  // FreeCut's plugin is mounted by the Web profile patch so it can also
  // register the default workspace before the first browser session exists.
  await fs.writeFile(path.join(presetDir, 'agent.cordis.yml'), standard, { encoding: 'utf8', mode: 0o600 })
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
  for (const [requestId, pending] of pendingSourceToolRequests) {
    clearTimeout(pending.timeout)
    pendingSourceToolRequests.delete(requestId)
    pending.reject(new Error('DeepSeek Harness 已关闭。'))
    const target = webContents.fromId(pending.senderId)
    if (target && !target.isDestroyed()) {
      target.send('deepseek-harness:source-tool-cancel', { requestId })
    }
  }
  const children = new Set<ChildProcess>()
  if (current) children.add(current.process)
  if (startingChild) children.add(startingChild)
  await Promise.all([...children].map((child) => terminateChild(child)))
}

async function startRuntime(projectId: string, generation: number): Promise<string> {
  const endpoint = await ensureSourceToolServer()
  const token = randomUUID()
  const baseDir = currentBaseDir()
  const home = harnessHomeForBaseDir(baseDir)
  const sessionRoot = harnessSessionRootForBaseDir(baseDir)
  const cwd = createAiEditingSourceGitService(baseDir, projectId).rootPath
  await prepareHarnessHome(projectId, token, endpoint, cwd, home)
  await fs.mkdir(sessionRoot, { recursive: true, mode: 0o700 })
  if (home !== dshHome()) throw new Error('DeepSeek Harness Web 启动已取消。')
  if (generation !== runtimeGeneration) throw new Error('DeepSeek Harness Web 启动已取消。')
  const child = spawn(harnessNodeExecutable(), [cliEntry(), 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_SESSION_ROOT: sessionRoot,
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
    runtime = { projectId, key: projectId, home, process: child, token, url }
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
  clearTimeout(pending.timeout)
  if (payload.ok) pending.resolve(payload.result)
  else pending.reject(new Error(payload.error || '源码工具调用失败。'))
}

export function cancelDeepSeekHarnessSourceToolRequest(
  senderId: number | undefined,
  requestId: string,
  message = '源码工具调用已取消。',
): void {
  const pending = pendingSourceToolRequests.get(requestId)
  if (!pending || (senderId !== undefined && pending.senderId !== senderId)) return
  pendingSourceToolRequests.delete(requestId)
  clearTimeout(pending.timeout)
  pending.reject(new Error(message))
  const target = webContents.fromId(pending.senderId)
  if (target && !target.isDestroyed()) {
    target.send('deepseek-harness:source-tool-cancel', { requestId })
  }
}

export async function getDeepSeekHarnessWebUrl(projectId: string): Promise<string> {
  const key = projectId
  const home = dshHome()
  if (runtime?.key === key && runtime.home === home && runtime.process.exitCode === null) return runtime.url
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
