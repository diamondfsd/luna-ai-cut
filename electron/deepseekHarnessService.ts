import { BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'

import { withDeepSeekHarnessDefaults } from './deepseekHarnessDefaults'
import { currentBaseDir } from './settingsService'
import { deepSeekHarnessCapabilities } from './deepseekHarnessCapabilities'
import type {
  DeepSeekHarnessContext,
  DeepSeekHarnessToolRequest,
  DeepSeekHarnessWebState,
} from '../src/shared/types'

const DEFAULT_HARNESS_MODEL = 'deepseek-v4-flash'
const MAX_CONTEXT_STRING_LENGTH = 200

interface HarnessRuntime {
  home: string
  process: ChildProcess
  token: string
  url: string
}

interface HarnessNodeCommand {
  executable: string
  args: string[]
  env: Partial<NodeJS.ProcessEnv>
}

const listeners = new Set<(state: DeepSeekHarnessWebState) => void>()
let runtime: HarnessRuntime | undefined
let startingRuntime: Promise<string> | undefined
let startingRuntimeGeneration: number | undefined
let startingChild: ChildProcess | undefined
let runtimeGeneration = 0
let toolServer: Server | undefined
let toolEndpoint: string | undefined
let assistantWindow: BrowserWindow | undefined

function appRoot(): string {
  return process.env.APP_ROOT ?? path.resolve(__dirname, '..')
}

function harnessSourceRoot(): string | null {
  const configured = process.env.LUNA_DEEPSEEK_HARNESS_ROOT?.trim()
  const candidates = [
    configured,
    path.join(appRoot(), 'vendor/deepseek-harness'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => existsSync(path.join(candidate, 'package.json'))) ?? null
}

function packagedHarnessRoot(): string {
  return path.join(process.resourcesPath, 'deepseek-harness')
}

function cliEntry(): string {
  const sourceRoot = harnessSourceRoot()
  const candidates = [
    sourceRoot ? path.join(sourceRoot, 'apps/cli/lib/bin.js') : null,
    path.join(appRoot(), 'dist/deepseek-harness/lib/bin.js'),
    path.join(packagedHarnessRoot(), 'lib/bin.js'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('DeepSeek Harness Web 运行时尚未构建，请先构建独立 Harness。')
  return found
}

function harnessNodeCommand(): HarnessNodeCommand {
  const override = process.env.LUNA_HARNESS_NODE_PATH
  if (override && existsSync(override)) {
    return { executable: override, args: ['--expose-internals'], env: {} }
  }
  return {
    executable: process.execPath,
    args: ['--expose-internals'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

function harnessHomeForBaseDir(baseDir: string): string {
  return path.join(baseDir, 'deepseek-harness')
}

function harnessSessionRootForBaseDir(baseDir: string): string {
  return path.join(harnessHomeForBaseDir(baseDir), 'sessions')
}

function dshHome(): string {
  return harnessHomeForBaseDir(currentBaseDir())
}

function emitState(state: DeepSeekHarnessWebState): void {
  for (const listener of listeners) listener(state)
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
    if (size > 2_000_000) throw new Error('助手能力请求过大。')
    chunks.push(buffer)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('助手能力请求格式无效。')
  }
  return value as Record<string, unknown>
}

function stringField(value: unknown, name: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CONTEXT_STRING_LENGTH) {
    throw new Error(`助手能力请求的 ${name} 无效。`)
  }
  return value
}

function contextFromBody(body: Record<string, unknown>): DeepSeekHarnessContext {
  const sessionId = stringField(body.sessionId, 'sessionId', true)
  if (!sessionId) throw new Error('助手能力请求缺少 sessionId。')
  const metadata = body.metadata
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    throw new Error('助手能力请求的 metadata 无效。')
  }
  return {
    sessionId,
    feature: stringField(body.feature, 'feature'),
    projectId: stringField(body.projectId, 'projectId'),
    metadata: metadata as Record<string, string> | undefined,
  }
}

function toolRequestFromBody(body: Record<string, unknown>, context: DeepSeekHarnessContext): DeepSeekHarnessToolRequest {
  const requestId = stringField(body.requestId, 'requestId', true)
  const name = stringField(body.name, 'name', true)
  const args = body.args
  if (!requestId || !name || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('助手能力请求参数无效。')
  }
  return {
    requestId,
    sessionId: context.sessionId,
    feature: context.feature,
    projectId: context.projectId,
    name,
    args: args as Record<string, unknown>,
  }
}

async function handleToolRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    jsonResponse(response, 405, { ok: false, error: 'method not allowed' })
    return
  }
  if (request.headers.authorization !== `Bearer ${runtime?.token ?? ''}`) {
    jsonResponse(response, 401, { ok: false, error: 'unauthorized' })
    return
  }

  const controller = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded && !controller.signal.aborted) controller.abort()
  }
  request.once('aborted', cancel)
  response.once('close', cancel)
  try {
    const body = await readRequestBody(request)
    const context = contextFromBody(body)
    const toolRequest = toolRequestFromBody(body, context)
    const result = await deepSeekHarnessCapabilities.execute(toolRequest, context, controller.signal)
    jsonResponse(response, 200, { ok: true, result })
  } catch (error) {
    if (response.destroyed || response.writableEnded) return
    jsonResponse(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : '助手能力调用失败。',
    })
  } finally {
    request.removeListener('aborted', cancel)
    response.removeListener('close', cancel)
  }
}

async function ensureToolServer(): Promise<string> {
  if (toolEndpoint) return toolEndpoint
  toolServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname !== '/capability') {
      jsonResponse(response, 404, { ok: false, error: 'not found' })
      return
    }
    void handleToolRequest(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    toolServer?.once('error', reject)
    toolServer?.listen(0, '127.0.0.1', resolve)
  })
  const address = toolServer.address()
  if (!address || typeof address === 'string') throw new Error('无法启动助手能力通道。')
  toolEndpoint = `http://127.0.0.1:${String(address.port)}/capability`
  return toolEndpoint
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

async function prepareHarnessHome(home: string): Promise<void> {
  const settingsPath = path.join(home, 'settings.yaml')
  const currentSettings = withDeepSeekHarnessDefaults(await readDocument(settingsPath))
  const existingPresets = currentSettings['agent-presets']
  currentSettings['agent-presets'] = {
    ...(existingPresets && typeof existingPresets === 'object' && !Array.isArray(existingPresets) ? existingPresets : {}),
    default: 'standard',
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
  const children = new Set<ChildProcess>()
  if (current) children.add(current.process)
  if (startingChild) children.add(startingChild)
  await Promise.all([...children].map((child) => terminateChild(child)))
}

function assistantPageUrl(): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) return `${devServerUrl.replace(/\/$/u, '')}/#/assistant`
  return 'luna://app/index.html#/assistant'
}

export function openDeepSeekHarnessWindow(): void {
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    assistantWindow.focus()
    return
  }
  assistantWindow = new BrowserWindow({
    title: 'Luna AI 助手',
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    icon: path.join(appRoot(), 'build', process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })
  assistantWindow.once('ready-to-show', () => assistantWindow?.show())
  assistantWindow.on('closed', () => {
    assistantWindow = undefined
  })
  void assistantWindow.loadURL(assistantPageUrl())
}

export function closeDeepSeekHarnessWindow(): void {
  if (assistantWindow && !assistantWindow.isDestroyed()) assistantWindow.close()
  assistantWindow = undefined
}

async function startRuntime(context: DeepSeekHarnessContext, generation: number): Promise<string> {
  const endpoint = await ensureToolServer()
  const token = randomUUID()
  const baseDir = currentBaseDir()
  const home = harnessHomeForBaseDir(baseDir)
  const sessionRoot = harnessSessionRootForBaseDir(baseDir)
  await fs.mkdir(sessionRoot, { recursive: true, mode: 0o700 })
  await prepareHarnessHome(home)
  if (home !== dshHome() || generation !== runtimeGeneration) throw new Error('DeepSeek Harness Web 启动已取消。')

  const nodeCommand = harnessNodeCommand()
  const child = spawn(nodeCommand.executable, [
    ...nodeCommand.args,
    cliEntry(),
    'web',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], {
    cwd: sessionRoot,
    env: {
      ...process.env,
      ...nodeCommand.env,
      DSH_HOME: home,
      DSH_SESSION_ROOT: sessionRoot,
      DSH_TELEMETRY_DISABLED: '1',
      LUNA_ASSISTANT_CAPABILITY_ENDPOINT: endpoint,
      LUNA_ASSISTANT_CAPABILITY_TOKEN: token,
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
  const fail = (error: Error): void => rejectUrl?.(error)
  const consume = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-64_000)
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/u)
    if (match?.[1]) resolveUrl?.(match[1])
  }
  child.stdout?.on('data', consume)
  child.stderr?.on('data', consume)
  child.once('error', fail)
  child.once('close', (code) => {
    if (code !== 0) fail(new Error(`DeepSeek Harness Web 已退出（${String(code ?? '未知错误')}）。`))
  })
  emitState({ sessionId: context.sessionId, status: 'starting' })
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
    runtime = { home, process: child, token, url }
    child.once('close', () => {
      if (runtime?.process === child) {
        runtime = undefined
        emitState({ sessionId: context.sessionId, status: 'error', error: 'DeepSeek Harness Web 已停止。' })
      }
    })
    emitState({ sessionId: context.sessionId, status: 'ready', url })
    return url
  } catch (error) {
    await terminateChild(child)
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    if (timeout) clearTimeout(timeout)
    if (startingChild === child) startingChild = undefined
  }
}

export function registerDeepSeekHarnessCapability(
  provider: Parameters<typeof deepSeekHarnessCapabilities.register>[0],
): () => void {
  return deepSeekHarnessCapabilities.register(provider)
}

export async function getDeepSeekHarnessWebUrl(context: DeepSeekHarnessContext): Promise<string> {
  const home = dshHome()
  if (runtime?.home === home && runtime.process.exitCode === null) return runtime.url
  if (!startingRuntime) {
    if (runtime) await stopRuntime()
    const generation = runtimeGeneration
    startingRuntimeGeneration = generation
    const pending = startRuntime(context, generation)
    startingRuntime = pending.finally(() => {
      if (startingRuntimeGeneration === generation) {
        startingRuntime = undefined
        startingRuntimeGeneration = undefined
      }
    })
  }
  return startingRuntime
}

export function onDeepSeekHarnessWebState(listener: (state: DeepSeekHarnessWebState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function disposeDeepSeekHarness(): Promise<void> {
  closeDeepSeekHarnessWindow()
  await stopRuntime()
  if (toolServer) {
    await new Promise<void>((resolve) => toolServer?.close(() => resolve()))
    toolServer = undefined
    toolEndpoint = undefined
  }
}
