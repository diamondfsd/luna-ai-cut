import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import type {
  RemotionClip,
  RemotionClipCreateInput,
  RemotionRenderTask,
  RemotionRenderTaskResult,
  RemotionSceneSpec,
  RemotionSourceSnapshot,
  RemotionSourceUpdateRequest,
} from '../src/shared/types/remotion'
import { getVideoFrameRate } from './mediaMetadataService'
import { mediaIdsForScene, parseRemotionSceneSpec } from '../integrations/remotion/src/scene-spec'
import { currentBaseDir } from './settingsService'
import { resolveWorkspaceMediaSourcePath } from './ipcFreecutWorkspaceService'
import { getWorkspaceProject } from './workspaceProjectService'
import {
  createRemotionClip,
  attachRemotionClipMedia,
  getRemotionClip,
  listRemotionClips,
  markRemotionClipRenderFailed,
  markRemotionClipRendering,
  readRemotionSource,
  REMOTION_CLIP_ENTRY_SOURCE,
  refreshRemotionClipStatus,
  remotionClipArtifactDirectory,
  remotionClipDirectory,
  remotionProjectDirectory,
  updateRemotionClipAfterRender,
  updateRemotionSource,
} from './remotionClipService'

interface RemotionMediaInput {
  id: string
  name: string
  path: string
}

interface RemotionTaskState {
  task: RemotionRenderTask
  ownerKey: string
  process?: ChildProcessWithoutNullStreams
  cancelRequested: boolean
  outputPath: string
  manifestPath: string
  temporaryDirectory: string
  clipSnapshot?: RemotionSourceSnapshot
  clip?: RemotionClip
}

type RemotionModelTask = Omit<RemotionRenderTask, 'result'> & {
  result?: Omit<RemotionRenderTaskResult, 'outputPath' | 'manifestPath'>
}

const tasks = new Map<string, RemotionTaskState>()
const MAX_ACTIVE_TASKS = 2
const rootRequire = createRequire(import.meta.url)

function appRoot(): string {
  return process.env.APP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function taskSnapshot(state: RemotionTaskState): RemotionRenderTask {
  return structuredClone(state.task)
}

function updateTask(state: RemotionTaskState, patch: Partial<RemotionRenderTask>): void {
  state.task = { ...state.task, ...patch, updatedAt: new Date().toISOString() }
}

async function cleanupTaskDirectory(state: RemotionTaskState): Promise<void> {
  await rm(state.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
}

interface RemotionGeneratedMediaMetadata {
  id: string
  storageType: 'workspace'
  fileName: string
  fileSize: number
  mimeType: 'video/mp4'
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  bitrate: number
  tags: string[]
  createdAt: number
  updatedAt: number
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function probeRenderedDurationSeconds(sourcePath: string, fallback: number): Promise<number> {
  const probed = await getVideoFrameRate({
    kind: 'video',
    downloadFilePath: sourcePath,
    localPath: sourcePath,
    cacheFilePath: null,
    sourceUrl: sourcePath,
    url: sourcePath,
  })
  return typeof probed.duration === 'number' && probed.duration > 0
    ? probed.duration
    : fallback
}

async function associateWorkspaceMedia(baseDir: string, projectId: string, mediaId: string): Promise<void> {
  const linksPath = path.join(remotionProjectDirectory(baseDir, projectId), 'media-links.json')
  let links: { version?: string; mediaIds?: Array<{ id: string; addedAt: number }> } = {
    version: '1.0',
    mediaIds: [],
  }
  try {
    links = JSON.parse(await readFile(linksPath, 'utf8')) as typeof links
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const mediaIds = Array.isArray(links.mediaIds) ? links.mediaIds : []
  if (mediaIds.some((entry) => entry?.id === mediaId)) return
  await writeJsonAtomic(linksPath, {
    version: links.version ?? '1.0',
    mediaIds: [...mediaIds, { id: mediaId, addedAt: Date.now() }],
  })
}

async function registerRenderedClipMedia(
  taskIdInput: unknown,
  context: { sessionId?: string; projectId?: string },
): Promise<{ taskId: string; clipId: string; mediaId: string; media: RemotionGeneratedMediaMetadata; durationSeconds: number }> {
  const projectId = requireProjectId(context.projectId)
  const taskId = typeof taskIdInput === 'string' ? taskIdInput : ''
  const state = requireTask(taskId)
  if (state.ownerKey !== ownerKey(context.sessionId, projectId)) throw new Error('Remotion task does not belong to this editor session')
  if (state.task.kind !== 'render' || state.task.status !== 'completed' || !state.task.result?.clipId) {
    throw new Error('Remotion 渲染任务尚未完成，不能加入时间线')
  }
  if (state.task.projectId !== projectId) throw new Error('Remotion task does not belong to this project')

  const clipId = state.task.result.clipId
  const clip = await getRemotionClip(currentBaseDir(), projectId, clipId)
  if (!clip?.artifact || clip.artifact.sourceRevision !== state.task.result.sourceRevision || clip.artifact.sourceHash !== state.task.result.sourceHash) {
    throw new Error('Remotion 渲染产物已过期，请重新渲染后再加入时间线')
  }
  const sourcePath = state.task.result.outputPath
  if (!sourcePath) throw new Error('Remotion 渲染产物路径缺失')
  const sourceStats = await stat(sourcePath).catch(() => null)
  if (!sourceStats?.isFile()) throw new Error('Remotion 渲染产物不存在')

  // The source can change its Composition duration without changing the
  // original RemotionClip metadata. Probe the rendered file so timeline
  // registration follows the artifact that will actually be played.
  const artifactDurationSeconds = await probeRenderedDurationSeconds(
    sourcePath,
    clip.durationInFrames / clip.fps,
  )

  const mediaId = clip.artifact.mediaId ?? `remotion-${clip.clipId}-${clip.sourceRevision}`
  const fileName = `${mediaId}.mp4`
  const mediaDirectory = path.join(currentBaseDir(), 'freecut-workspace', 'media', mediaId)
  const targetPath = path.join(mediaDirectory, fileName)
  await mkdir(mediaDirectory, { recursive: true })
  await copyFile(sourcePath, targetPath)
  const now = Date.now()
  const media: RemotionGeneratedMediaMetadata = {
    id: mediaId,
    storageType: 'workspace',
    fileName,
    fileSize: sourceStats.size,
    mimeType: 'video/mp4',
    duration: artifactDurationSeconds,
    width: clip.width,
    height: clip.height,
    fps: clip.fps,
    codec: 'h264',
    bitrate: 0,
    tags: ['remotion'],
    createdAt: now,
    updatedAt: now,
  }
  await writeJsonAtomic(path.join(mediaDirectory, 'metadata.json'), media)
  await associateWorkspaceMedia(currentBaseDir(), projectId, mediaId)
  await attachRemotionClipMedia(currentBaseDir(), projectId, clipId, mediaId)
  return { taskId, clipId, mediaId, media, durationSeconds: media.duration }
}

function ownerKey(sessionId?: string, projectId?: string): string {
  return `${sessionId ?? 'local'}:${projectId ?? 'local'}`
}

function workerPath(): string {
  return path.join(appRoot(), 'electron', 'remotion-render-worker.mjs')
}

function rendererRequire(): NodeRequire {
  return createRequire(rootRequire.resolve('@remotion/renderer'))
}

function compositorPackageName(): string {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? '@remotion/compositor-darwin-arm64' : '@remotion/compositor-darwin-x64'
  if (process.platform === 'win32') return '@remotion/compositor-win32-x64-msvc'
  if (process.platform === 'linux') return process.arch === 'arm64' ? '@remotion/compositor-linux-arm64-gnu' : '@remotion/compositor-linux-x64-gnu'
  throw new Error(`不支持的 Remotion 平台：${process.platform}-${process.arch}`)
}

function devBinariesDirectory(): string {
  return path.dirname(rendererRequire().resolve(`${compositorPackageName()}/package.json`))
}

function platformBrowserName(): string {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'win32') return 'win64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux64'
  throw new Error(`不支持的 Remotion 平台：${process.platform}-${process.arch}`)
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate
  }
  return null
}

async function browserExecutableFromRoot(root: string): Promise<string | null> {
  const platform = platformBrowserName()
  const folder = path.join(root, platform)
  const candidates = process.platform === 'win32'
    ? [path.join(folder, `chrome-headless-shell-${platform}`, 'chrome-headless-shell.exe')]
    : [path.join(folder, `chrome-headless-shell-${platform}`, process.platform === 'linux' && process.arch === 'arm64' ? 'headless_shell' : 'chrome-headless-shell')]
  return firstExisting(candidates)
}

async function runtimePaths(): Promise<{ binariesDirectory: string; browserExecutable: string }> {
  if (app.isPackaged) {
    const binariesDirectory = path.join(process.resourcesPath, 'remotion-binaries')
    const browser = await browserExecutableFromRoot(path.join(process.resourcesPath, 'remotion-browser'))
    if (!browser) throw new Error('应用内置的 Remotion 浏览器资源缺失，请重新安装完整版本。')
    if (!await access(path.join(binariesDirectory, process.platform === 'win32' ? 'remotion.exe' : 'remotion')).then(() => true).catch(() => false)) {
      throw new Error('应用内置的 Remotion 编码资源缺失，请重新安装完整版本。')
    }
    return { binariesDirectory, browserExecutable: browser }
  }

  const resourceBinaries = path.join(appRoot(), 'resources', 'remotion-binaries')
  const binariesDirectory = await access(path.join(resourceBinaries, process.platform === 'win32' ? 'remotion.exe' : 'remotion')).then(() => resourceBinaries).catch(() => devBinariesDirectory())
  const browser = await browserExecutableFromRoot(path.join(appRoot(), 'resources', 'remotion-browser'))
    ?? await browserExecutableFromRoot(path.join(appRoot(), 'node_modules', '.remotion', 'chrome-headless-shell'))
  if (!browser) throw new Error('Remotion 浏览器资源尚未准备，请先运行 pnpm prepare:remotion-runtime。')
  return { binariesDirectory, browserExecutable: browser }
}

async function resolveMediaIds(mediaIds: string[], projectId?: string): Promise<RemotionMediaInput[]> {
  const project = projectId ? await getWorkspaceProject(currentBaseDir(), projectId) : null
  const inputs: RemotionMediaInput[] = []
  for (const mediaId of [...new Set(mediaIds)]) {
    const workspacePath = await resolveWorkspaceMediaSourcePath(mediaId)
    const projectAsset = project?.assets.find((asset) => asset.id === mediaId)
    const mediaPath = workspacePath ?? projectAsset?.path
    if (!mediaPath) throw new Error(`项目素材不存在或尚未完成导入：${mediaId}`)
    inputs.push({ id: mediaId, name: path.basename(mediaPath), path: mediaPath })
  }
  return inputs
}

async function resolveMedia(scene: RemotionSceneSpec, projectId?: string): Promise<RemotionMediaInput[]> {
  return resolveMediaIds(mediaIdsForScene(scene), projectId)
}

function activeTaskCount(): number {
  return [...tasks.values()].filter((state) => state.process || ['queued', 'bundling', 'rendering'].includes(state.task.status)).length
}

async function writeClipSnapshot(directory: string, snapshot: RemotionSourceSnapshot): Promise<string> {
  const sourceDirectory = path.join(directory, 'src')
  await mkdir(sourceDirectory, { recursive: true })
  for (const [filePath, content] of Object.entries(snapshot.files)) {
    const relative = filePath.slice('src/'.length)
    const target = path.join(sourceDirectory, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600 })
  }
  await writeFile(path.join(directory, 'entry.tsx'), REMOTION_CLIP_ENTRY_SOURCE, { encoding: 'utf8', mode: 0o600 })
  return path.join(directory, 'entry.tsx')
}

async function spawnRenderWorker(state: RemotionTaskState, input: Record<string, unknown>): Promise<{ fileSize: number; sha256: string }> {
  const runtime = await runtimePaths()
  if (state.cancelRequested) throw new Error('Remotion render canceled')
  const child = spawn(process.execPath, [workerPath()], {
    cwd: appRoot(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  state.process = child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stdoutBuffer = ''
  let stderr = ''
  child.stdout.on('data', (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-32_000)
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('LUNA_REMOTION_EVENT:')) continue
      try {
        const event = JSON.parse(line.slice('LUNA_REMOTION_EVENT:'.length)) as { type?: string; status?: RemotionRenderTask['status']; progress?: number }
        if (event.type === 'status' && event.status && typeof event.progress === 'number') {
          updateTask(state, { status: event.status, progress: Math.max(0, Math.min(1, event.progress)) })
        }
      } catch {
        // Worker diagnostics do not affect the task protocol.
      }
    }
  })
  child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_000) })
  updateTask(state, { status: 'queued', progress: 0 })
  child.stdin.end(JSON.stringify({
    rootDir: appRoot(),
    bundleDirectory: path.join(state.temporaryDirectory, 'bundle'),
    binariesDirectory: runtime.binariesDirectory,
    browserExecutable: runtime.browserExecutable,
    outputPath: state.outputPath,
    manifestPath: state.manifestPath,
    ...input,
  }))

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  state.process = undefined
  if (state.cancelRequested) throw new Error('Remotion render canceled')
  if (exit.code !== 0) throw new Error(stderr.trim() || `Remotion worker exited with ${String(exit.code ?? exit.signal)}`)
  const resultLine = stdout.split('\n').find((line) => line.startsWith('LUNA_REMOTION_RESULT:'))
  if (!resultLine) throw new Error('Remotion worker did not return a result')
  return JSON.parse(resultLine.slice('LUNA_REMOTION_RESULT:'.length)) as { fileSize: number; sha256: string }
}

async function runLegacyTask(state: RemotionTaskState, scene: RemotionSceneSpec, media: RemotionMediaInput[]): Promise<void> {
  try {
    const result = await spawnRenderWorker(state, {
      entryPoint: path.join(appRoot(), 'integrations', 'remotion', 'src', 'index.tsx'),
      compositionId: scene.composition,
      scene,
      media,
      kind: 'legacy',
    })
    const taskResult: RemotionRenderTaskResult = {
      artifactId: `remotion-${state.task.taskId}`,
      outputPath: state.outputPath,
      manifestPath: state.manifestPath,
      fileSize: result.fileSize,
      sha256: result.sha256,
      mimeType: 'video/mp4',
    }
    updateTask(state, { status: 'completed', progress: 1, result: taskResult })
  } catch (error) {
    state.process = undefined
    if (state.cancelRequested) updateTask(state, { status: 'canceled', progress: 0 })
    else updateTask(state, { status: 'failed', progress: 0, error: error instanceof Error ? error.message : String(error) })
    await cleanupTaskDirectory(state)
  }
}

async function runClipTask(state: RemotionTaskState, media: RemotionMediaInput[]): Promise<void> {
  const clip = state.clip
  const snapshot = state.clipSnapshot
  if (!clip || !snapshot) throw new Error('RemotionClip render state is incomplete')
  try {
    const entryPoint = await writeClipSnapshot(state.temporaryDirectory, snapshot)
    const result = await spawnRenderWorker(state, {
      entryPoint,
      compositionId: clip.compositionId,
      clipId: clip.clipId,
      projectId: clip.projectId,
      sourceRevision: snapshot.sourceRevision,
      sourceHash: snapshot.sourceHash,
      kind: state.task.kind,
      media,
    })
    const artifactId = `remotion-${state.task.taskId}`
    const artifactDirectory = remotionClipArtifactDirectory(currentBaseDir(), clip.projectId, clip.clipId)
    await mkdir(artifactDirectory, { recursive: true })
    const outputName = `${artifactId}.mp4`
    const manifestName = `${artifactId}.json`
    const outputPath = path.join(artifactDirectory, outputName)
    const manifestPath = path.join(artifactDirectory, manifestName)
    await rename(state.outputPath, outputPath)
    await rename(state.manifestPath, manifestPath)
    const relativeOutputPath = path.posix.join('artifacts', outputName)
    const relativeManifestPath = path.posix.join('artifacts', manifestName)
    const artifactDurationSeconds = await probeRenderedDurationSeconds(
      outputPath,
      clip.durationInFrames / clip.fps,
    )
    const artifactDurationInFrames = Math.max(1, Math.round(artifactDurationSeconds * clip.fps))
    const artifact: NonNullable<RemotionClip['artifact']> = {
      artifactId,
      outputPath: relativeOutputPath,
      manifestPath: relativeManifestPath,
      sourceRevision: snapshot.sourceRevision,
      sourceHash: snapshot.sourceHash,
      fileSize: result.fileSize,
      sha256: result.sha256,
      mimeType: 'video/mp4',
    }
    const current = state.task.kind === 'render'
      ? await updateRemotionClipAfterRender(
        currentBaseDir(),
        clip.projectId,
        clip.clipId,
        artifact,
        snapshot.sourceRevision,
        snapshot.sourceHash,
        artifactDurationInFrames,
      )
      : await refreshRemotionClipStatus(currentBaseDir(), clip.projectId, clip.clipId)
    const taskResult: RemotionRenderTaskResult = {
      ...artifact,
      outputPath,
      manifestPath,
      projectId: clip.projectId,
      clipId: clip.clipId,
      sourceRevision: snapshot.sourceRevision,
      sourceHash: snapshot.sourceHash,
    }
    updateTask(state, {
      status: 'completed',
      progress: 1,
      result: taskResult,
      ...(current && current.sourceRevision !== snapshot.sourceRevision ? { error: '源码在渲染期间发生变化，当前预览未绑定到最新源码。' } : {}),
    })
    await cleanupTaskDirectory(state)
  } catch (error) {
    state.process = undefined
    if (state.cancelRequested) {
      updateTask(state, { status: 'canceled', progress: 0 })
      await refreshRemotionClipStatus(currentBaseDir(), clip.projectId, clip.clipId)
    }
    else {
      const message = error instanceof Error ? error.message : String(error)
      updateTask(state, { status: 'failed', progress: 0, error: message })
      await markRemotionClipRenderFailed(currentBaseDir(), clip.projectId, clip.clipId, snapshot.sourceRevision, snapshot.sourceHash, message)
    }
    await cleanupTaskDirectory(state)
  }
}

function requireTask(taskId: unknown): RemotionTaskState {
  if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 200) throw new TypeError('taskId is invalid')
  const state = tasks.get(taskId)
  if (!state) throw new Error(`Remotion task not found: ${taskId}`)
  return state
}

function requireProjectId(projectId: unknown): string {
  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 100) throw new TypeError('projectId is required')
  return projectId
}

function taskForModel(task: RemotionRenderTask | null): RemotionModelTask | null {
  if (!task?.result) return task
  const safeResult = Object.fromEntries(
    Object.entries(task.result).filter(([key]) => key !== 'outputPath' && key !== 'manifestPath'),
  ) as Omit<RemotionRenderTaskResult, 'outputPath' | 'manifestPath'>
  return { ...task, result: safeResult }
}

export async function startRemotionRender(sceneInput: unknown, sessionId?: string, projectId?: string): Promise<RemotionRenderTask> {
  if (activeTaskCount() >= MAX_ACTIVE_TASKS) throw new Error('Remotion 渲染任务已达到并发上限，请稍后再试。')
  const scene = parseRemotionSceneSpec(sceneInput)
  const media = await resolveMedia(scene, projectId)
  const taskId = randomUUID()
  const temporaryDirectory = path.join(currentBaseDir(), 'freecut-workspace', 'remotion-renders', taskId)
  const state: RemotionTaskState = {
    task: { taskId, status: 'queued', progress: 0, kind: 'legacy', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ownerKey: ownerKey(sessionId, projectId),
    cancelRequested: false,
    outputPath: path.join(temporaryDirectory, 'render.mp4'),
    manifestPath: path.join(temporaryDirectory, 'render-manifest.json'),
    temporaryDirectory,
  }
  tasks.set(taskId, state)
  void runLegacyTask(state, scene, media)
  return taskSnapshot(state)
}

async function startClipRender(
  projectId: string,
  clipId: string,
  kind: 'preview' | 'render',
  expectedRevision: number | undefined,
  sessionId?: string,
): Promise<RemotionRenderTask> {
  if (activeTaskCount() >= MAX_ACTIVE_TASKS) throw new Error('Remotion 渲染任务已达到并发上限，请稍后再试。')
  const clip = await getRemotionClip(currentBaseDir(), projectId, clipId)
  if (!clip) throw new Error('RemotionClip 不存在')
  if (expectedRevision !== undefined && expectedRevision !== clip.sourceRevision) throw new Error(`RemotionClip 源码版本已变化，当前版本为 ${clip.sourceRevision}`)
  const snapshot = await readRemotionSource(currentBaseDir(), projectId, clipId)
  const media = await resolveMediaIds(clip.mediaIds, projectId)
  const taskId = randomUUID()
  const temporaryDirectory = path.join(remotionClipDirectory(currentBaseDir(), projectId, clipId), `.render-${taskId}`)
  const state: RemotionTaskState = {
    task: {
      taskId,
      projectId,
      clipId,
      sourceRevision: snapshot.sourceRevision,
      sourceHash: snapshot.sourceHash,
      kind,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    ownerKey: ownerKey(sessionId, projectId),
    cancelRequested: false,
    outputPath: path.join(temporaryDirectory, 'render.mp4'),
    manifestPath: path.join(temporaryDirectory, 'render-manifest.json'),
    temporaryDirectory,
    clipSnapshot: snapshot,
    clip,
  }
  tasks.set(taskId, state)
  await markRemotionClipRendering(currentBaseDir(), projectId, clipId, snapshot.sourceRevision, snapshot.sourceHash)
  void runClipTask(state, media)
  return taskSnapshot(state)
}

export async function getRemotionTask(taskIdInput: unknown, sessionId?: string, projectId?: string): Promise<RemotionRenderTask | null> {
  const state = requireTask(taskIdInput)
  if (state.ownerKey !== ownerKey(sessionId, projectId)) throw new Error('Remotion task does not belong to this editor session')
  return taskSnapshot(state)
}

export async function cancelRemotionTask(taskIdInput: unknown, sessionId?: string, projectId?: string): Promise<RemotionRenderTask | null> {
  const state = requireTask(taskIdInput)
  if (state.ownerKey !== ownerKey(sessionId, projectId)) throw new Error('Remotion task does not belong to this editor session')
  if (['completed', 'failed', 'canceled'].includes(state.task.status)) return taskSnapshot(state)
  state.cancelRequested = true
  state.process?.kill('SIGTERM')
  updateTask(state, { status: 'canceled', progress: 0 })
  return taskSnapshot(state)
}

function clipInput(value: unknown): RemotionClipCreateInput {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('RemotionClip 创建参数无效')
  return value as RemotionClipCreateInput
}

export async function executeRemotionCapability(
  name: string,
  args: Record<string, unknown>,
  context: { sessionId?: string; projectId?: string },
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  if (name === 'render.remotion.start') return taskForModel(await startRemotionRender(args.scene, context.sessionId, context.projectId))
  if (name === 'render.remotion.get_task') return taskForModel(await getRemotionTask(args.taskId, context.sessionId, context.projectId))
  if (name === 'render.remotion.cancel') return taskForModel(await cancelRemotionTask(args.taskId, context.sessionId, context.projectId))
  if (name === 'render.remotion.add_to_timeline') {
    return registerRenderedClipMedia(args.taskId, context)
  }
  const projectId = requireProjectId(context.projectId)
  if (name === 'render.remotion.create') return createRemotionClip(currentBaseDir(), projectId, clipInput(args.input))
  if (name === 'render.remotion.list') return listRemotionClips(currentBaseDir(), projectId)
  if (name === 'render.remotion.get') return getRemotionClip(currentBaseDir(), projectId, args.clipId as string)
  if (name === 'render.remotion.read_source') return readRemotionSource(currentBaseDir(), projectId, args.clipId as string)
  if (name === 'render.remotion.update_source') {
    return updateRemotionSource(currentBaseDir(), {
      projectId,
      clipId: args.clipId as string,
      expectedRevision: args.expectedRevision as number,
      files: args.files as RemotionSourceUpdateRequest['files'],
      removeFiles: args.removeFiles as string[] | undefined,
    })
  }
  if (name === 'render.remotion.preview' || name === 'render.remotion.render') {
    return taskForModel(await startClipRender(projectId, args.clipId as string, name.endsWith('.preview') ? 'preview' : 'render', args.expectedRevision as number | undefined, context.sessionId))
  }
  throw new Error(`未知的 Remotion 能力：${name}`)
}

export async function disposeRemotionRenderService(): Promise<void> {
  for (const state of tasks.values()) {
    state.cancelRequested = true
    state.process?.kill('SIGTERM')
  }
  await Promise.all([...tasks.values()].map(async (state) => {
    if (state.process) await new Promise<void>((resolve) => state.process?.once('close', () => resolve()))
    await cleanupTaskDirectory(state)
  }))
}
