import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

import { withDeepSeekHarnessDefaults } from './deepseekHarnessDefaults'
import { currentBaseDir } from './settingsService'
import { deepSeekHarnessCapabilities } from './deepseekHarnessCapabilities'
import { prepareHarnessSession } from './deepseekHarnessSession'
import type {
  DeepSeekHarnessContext,
  DeepSeekHarnessToolRequest,
  DeepSeekHarnessWebState,
} from '../src/shared/types'

const MAX_CONTEXT_STRING_LENGTH = 200
const LUNA_EDITOR_PROTOCOL = 'luna.editor' as const
const LUNA_EDITOR_API_VERSION = 1 as const

interface HarnessRuntime {
  home: string
  process: ChildProcess
  token: string
  url: string
  context: DeepSeekHarnessContext
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

function appRoot(): string {
  return process.env.APP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  if (body.protocol !== LUNA_EDITOR_PROTOCOL || body.apiVersion !== LUNA_EDITOR_API_VERSION) {
    throw new Error('助手能力请求协议版本不受支持。')
  }
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

function sha256Revision(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex')}`
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function structuredResult(request: DeepSeekHarnessToolRequest, value: unknown): Record<string, unknown> {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
  const mutation = request.name !== 'project.inspect' && request.name !== 'timeline.inspect' &&
    request.name !== 'media.list' && request.name !== 'media.inspect' &&
    !request.name.startsWith('preview.') && !request.name.startsWith('capabilities.')
  return {
    kind: mutation ? 'edit' : 'data',
    revision: sha256Revision(record?.project ?? value),
    affectedIds: stringArrayField(record?.affectedIds),
    createdIds: stringArrayField(record?.createdIds),
    removedIds: stringArrayField(record?.removedIds),
    warnings: stringArrayField(record?.warnings),
    data: value,
  }
}

function errorPayload(error: unknown): Record<string, unknown> {
  const candidate = error as { code?: unknown; details?: unknown; retryable?: unknown } | null
  const code = typeof candidate?.code === 'string' ? candidate.code : 'CAPABILITY_ERROR'
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    details: candidate?.details && typeof candidate.details === 'object' ? candidate.details : {},
    retryable: candidate?.retryable === true || code === 'TIMEOUT',
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
  let requestId: string | undefined
  const cancel = (): void => {
    if (!response.writableEnded && !controller.signal.aborted) controller.abort()
  }
  request.once('aborted', cancel)
  response.once('close', cancel)
  try {
    const body = await readRequestBody(request)
    requestId = typeof body.requestId === 'string' ? body.requestId : undefined
    const context = contextFromBody(body)
    const activeContext = runtime?.context
    if (!activeContext || activeContext.sessionId !== context.sessionId) {
      throw new Error('助手会话上下文不匹配。')
    }
    if (activeContext.projectId !== context.projectId) {
      throw new Error('助手项目上下文不匹配。')
    }
    const toolRequest = toolRequestFromBody(body, context)
    const dispatch = await deepSeekHarnessCapabilities.dispatch(toolRequest, context, controller.signal)
    jsonResponse(response, 200, {
      protocol: LUNA_EDITOR_PROTOCOL,
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId: toolRequest.requestId,
      ok: true,
      result: structuredResult(toolRequest, dispatch.result),
    })
  } catch (error) {
    if (response.destroyed || response.writableEnded) return
    jsonResponse(response, 400, {
      protocol: LUNA_EDITOR_PROTOCOL,
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId,
      ok: false,
      error: errorPayload(error),
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

function freecutHarnessPluginSource(): string {
  const candidates = [
    path.join(appRoot(), 'integrations/deepseek-harness/plugin.mjs'),
    ...(typeof process.resourcesPath === 'string'
      ? [path.join(process.resourcesPath, 'integrations/deepseek-harness/plugin.mjs')]
      : []),
  ]
  const source = candidates.find((candidate) => existsSync(candidate))
  if (!source) {
    throw new Error('Luna FreeCut SDK Harness 插件资源不存在。')
  }
  return source
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function removeLegacyFreecutLoader(patches: unknown[]): { patches: unknown[]; changed: boolean } {
  let changed = false
  const retained: unknown[] = []

  for (const entry of patches) {
    if (!isRecord(entry)) {
      retained.push(entry)
      continue
    }
    if (entry.id === 'luna-freecut') {
      changed = true
      continue
    }

    const inserted = entry.insert
    if (!Array.isArray(inserted)) {
      retained.push(entry)
      continue
    }

    const filtered = inserted.filter((item) => !(isRecord(item) && item.id === 'luna-freecut'))
    if (filtered.length !== inserted.length) changed = true
    retained.push(filtered.length === inserted.length ? entry : { ...entry, insert: filtered })
  }

  return { patches: retained, changed }
}

async function removeLegacyFreecutPatch(home: string): Promise<void> {
  const patchPath = path.join(home, 'cordis.patch.yml')
  let parsed: unknown
  try {
    parsed = parse(await fs.readFile(patchPath, 'utf8'))
  } catch {
    return
  }
  if (!Array.isArray(parsed)) return

  const result = removeLegacyFreecutLoader(parsed)
  if (result.changed) await writePrivateDocument(patchPath, result.patches)
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
  // The current assistant is an independent Harness. Older Luna versions
  // persisted a FreeCut editing plugin in this patch file; that plugin expects
  // editing skill assets which are intentionally not part of this build.
  await removeLegacyFreecutPatch(home)
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

type BoundHarnessContext = DeepSeekHarnessContext & { projectId: string }

function requireProjectContext(context: DeepSeekHarnessContext): asserts context is BoundHarnessContext {
  if (!context.projectId) throw new Error('请先打开一个 FreeCut 剪辑项目。')
}

async function startRuntime(context: BoundHarnessContext, generation: number): Promise<string> {
  const endpoint = await ensureToolServer()
  const token = randomUUID()
  const baseDir = currentBaseDir()
  const home = harnessHomeForBaseDir(baseDir)
  const sessionRoot = harnessSessionRootForBaseDir(baseDir)
  await fs.mkdir(sessionRoot, { recursive: true, mode: 0o700 })
  await prepareHarnessHome(home)
  const sessionPatchPath = await prepareHarnessSession(sessionRoot, freecutHarnessPluginSource(), {
    projectId: context.projectId,
    projectName: context.metadata?.projectName,
  })
  if (home !== dshHome() || generation !== runtimeGeneration) throw new Error('DeepSeek Harness Web 启动已取消。')

  const nodeCommand = harnessNodeCommand()
  const child = spawn(nodeCommand.executable, [
    ...nodeCommand.args,
    cliEntry(),
    'web',
    '--patch',
    sessionPatchPath,
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
      LUNA_ASSISTANT_SESSION_ID: context.sessionId,
      LUNA_ASSISTANT_CWD: sessionRoot,
      LUNA_SDK_ENDPOINT: endpoint,
      LUNA_SDK_TOKEN: token,
      LUNA_SDK_SESSION_ID: context.sessionId,
      LUNA_SDK_CWD: sessionRoot,
      ...(context.projectId ? { LUNA_ASSISTANT_PROJECT_ID: context.projectId } : {}),
      ...(context.projectId ? { LUNA_SDK_PROJECT_ID: context.projectId } : {}),
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
    runtime = { home, process: child, token, url, context: { ...context } }
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
  requireProjectContext(context)
  const home = dshHome()
  if (runtime?.home === home
    && runtime.process.exitCode === null
    && runtime.context.sessionId === context.sessionId
    && runtime.context.projectId === context.projectId) {
    return runtime.url
  }
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
  await stopRuntime()
  if (toolServer) {
    await new Promise<void>((resolve) => toolServer?.close(() => resolve()))
    toolServer = undefined
    toolEndpoint = undefined
  }
}
