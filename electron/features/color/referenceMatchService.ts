import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { AppSettings, WorkspaceReferenceMatchAiLutRequest, WorkspaceReferenceMatchAiLutResult, WorkspaceReferenceMatchLutRequest, WorkspaceReferenceMatchLutResult } from '../../../src/shared/types'
import { safeName } from '../../media/filePathUtils.ts'
import { generatePairedReferenceMatchLut, type ReferenceMatchImage } from '../../../src/workspace/color/referenceMatch.ts'

const CACHE_CATEGORY = 'reference-match'
const PROJECTS_DIR = 'workspace-projects'
const PROJECT_FILE = 'project.json'
const MAX_PROJECT_ID_LENGTH = 100
const LUT_SIZES = new Set([17, 33])
const MAX_CUBE_BYTES = 8 * 1024 * 1024
const AI_INPUT_SIZE = 256
const execFileAsync = promisify(execFile)
let aiLutGenerationQueue: Promise<void> = Promise.resolve()

function enqueueAiLutGeneration<T>(task: () => Promise<T>): Promise<T> {
  const result = aiLutGenerationQueue.then(() => task())
  // 单次任务失败后仍允许后续粘贴继续处理。
  aiLutGenerationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function referenceMatchRoot(settings: AppSettings, projectId: string): Promise<string> {
  if (!projectId) throw new Error('追色项目不完整')
  if (
    projectId.length > MAX_PROJECT_ID_LENGTH
    || projectId === '.'
    || projectId === '..'
    || !/^[\w.-]+$/.test(projectId)
  ) {
    throw new Error('项目标识无效')
  }
  const projectRoot = path.resolve(settings.baseDir, PROJECTS_DIR)
  const projectDirectory = path.resolve(projectRoot, projectId)
  const relativeProjectPath = path.relative(projectRoot, projectDirectory)
  if (!relativeProjectPath || relativeProjectPath === '..' || relativeProjectPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeProjectPath)) {
    throw new Error('项目目录无效')
  }
  const projectStats = await fs.lstat(projectDirectory).catch(() => null)
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) throw new Error('项目目录无效')
  await fs.access(path.join(projectDirectory, PROJECT_FILE))

  const realProjectDirectory = await fs.realpath(projectDirectory)
  const directory = path.join(realProjectDirectory, 'cache', CACHE_CATEGORY)
  await fs.mkdir(directory, { recursive: true })
  const realDirectory = await fs.realpath(directory)
  const relative = path.relative(realProjectDirectory, realDirectory)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('追色缓存目录无效')
  }
  return realDirectory
}

function validateCube(cube: string): void {
  if (typeof cube !== 'string' || Buffer.byteLength(cube, 'utf8') <= 0 || Buffer.byteLength(cube, 'utf8') > MAX_CUBE_BYTES) {
    throw new Error('追色结果无效或过大')
  }
  let size = 0
  let rows = 0
  for (const rawLine of cube.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('DOMAIN_')) continue
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number(line.slice('LUT_3D_SIZE'.length).trim())
      continue
    }
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    if (parts.slice(0, 3).every((part) => Number.isFinite(Number(part)))) rows += 1
  }
  if (!LUT_SIZES.has(size) || rows !== size ** 3) throw new Error('追色结果尺寸不正确')
}

function cleanName(value: string): string {
  const normalized = safeName(value.trim()).replace(/\s+/g, ' ').slice(0, 80).trim()
  return normalized || '参考图追色'
}

export async function saveReferenceMatchLut(
  settings: AppSettings,
  request: WorkspaceReferenceMatchLutRequest,
): Promise<WorkspaceReferenceMatchLutResult> {
  validateCube(request.cube)
  if (!request.referenceAssetId || !request.targetAssetId) throw new Error('追色素材信息不完整')

  const displayName = cleanName(request.name)
  const fileBaseName = cleanName(`${displayName}_${Date.now()}`)
  const directory = await referenceMatchRoot(settings, request.projectId)
  const destination = path.join(directory, `${fileBaseName}.cube`)
  const metadata = {
    name: displayName,
    description: request.description?.trim() || `根据「${request.referenceName}」为「${request.targetName}」生成的参考图追色`,
    source: 'Luna AI Cut',
    kind: 'reference-match',
    method: request.method,
    version: 1,
    generatedAt: new Date().toISOString(),
    referenceAssetId: request.referenceAssetId,
    targetAssetId: request.targetAssetId,
    referenceName: request.referenceName,
    targetName: request.targetName,
  }
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(directory, { recursive: true })
  try {
    await fs.writeFile(temporary, request.cube, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
    await fs.writeFile(`${destination}.meta.json`, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 })
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
  return { path: destination, name: displayName, category: CACHE_CATEGORY }
}

async function getFfmpegPathAtRuntime(): Promise<string> {
  const { getFfmpegPath } = await import('../../platform/ffmpeg/pipeline')
  return getFfmpegPath()
}

async function getWorkerPathAtRuntime(): Promise<string> {
  const { app } = await import('electron')
  const executable = process.platform === 'win32' ? 'neural-preset-worker.exe' : 'neural-preset-worker'
  const appRoot = process.env.APP_ROOT ?? path.join(import.meta.dirname, '..', '..')
  return app.isPackaged
    ? path.join(process.resourcesPath, 'luna-render-core', executable)
    : path.join(appRoot, 'luna-render-core', executable)
}

async function decodeRgb(filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(await getFfmpegPathAtRuntime(), [
    '-v', 'error',
    '-i', filePath,
    '-vf', `scale=${AI_INPUT_SIZE}:${AI_INPUT_SIZE}:flags=lanczos`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ], { encoding: 'buffer', maxBuffer: AI_INPUT_SIZE * AI_INPUT_SIZE * 3 + 1024 })
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (bytes.byteLength !== AI_INPUT_SIZE * AI_INPUT_SIZE * 3) throw new Error('无法读取追色图片')
  return bytes
}

function rgbBufferToReferenceMatchImage(data: Buffer): ReferenceMatchImage {
  const rgba = new Uint8Array(AI_INPUT_SIZE * AI_INPUT_SIZE * 4)
  for (let sourceOffset = 0, targetOffset = 0; sourceOffset < data.length; sourceOffset += 3, targetOffset += 4) {
    rgba[targetOffset] = data[sourceOffset]
    rgba[targetOffset + 1] = data[sourceOffset + 1]
    rgba[targetOffset + 2] = data[sourceOffset + 2]
    rgba[targetOffset + 3] = 255
  }
  return { width: AI_INPUT_SIZE, height: AI_INPUT_SIZE, data: rgba }
}

async function generateReferenceMatchAiLutInternal(
  settings: AppSettings,
  request: WorkspaceReferenceMatchAiLutRequest,
): Promise<WorkspaceReferenceMatchAiLutResult> {
  if (!request.targetPath || !request.referencePath || !request.targetAssetId || !request.referenceAssetId) {
    throw new Error('追色素材信息不完整')
  }
  const { loadModel } = await import('../../infrastructure/modelLoader')
  const model = await loadModel('neural-preset-v1-256')
  const root = await referenceMatchRoot(settings, request.projectId)
  const directory = await fs.mkdtemp(path.join(root, '.neural-preset-'))
  const contentPath = path.join(directory, 'content.rgb')
  const stylePath = path.join(directory, 'style.rgb')
  const outputRgbPath = path.join(directory, 'colored-content.rgb')
  const outputName = safeName(`AI追色_${request.targetName}_${request.referenceName}_${Date.now()}`)
  const destination = path.join(root, `${outputName}.cube`)
  try {
    const content = await decodeRgb(request.targetPath)
    const style = await decodeRgb(request.referencePath)
    await fs.writeFile(contentPath, content, { mode: 0o600 })
    await fs.writeFile(stylePath, style, { mode: 0o600 })
    await execFileAsync(await getWorkerPathAtRuntime(), [model.path, contentPath, stylePath, outputRgbPath], { timeout: 120_000, maxBuffer: 64 * 1024 })
    const transformed = await fs.readFile(outputRgbPath)
    const result = generatePairedReferenceMatchLut(
      rgbBufferToReferenceMatchImage(content),
      rgbBufferToReferenceMatchImage(transformed),
      { maxSamples: AI_INPUT_SIZE * AI_INPUT_SIZE },
    )
    await fs.writeFile(destination, result.cube, { encoding: 'utf8', mode: 0o600 })
    await fs.writeFile(`${destination}.meta.json`, JSON.stringify({
      name: outputName,
      kind: 'reference-match',
      method: 'neural-preset',
      model: { id: model.id, version: 'v1-256', sha256: model.sha256 },
      referenceAssetId: request.referenceAssetId,
      targetAssetId: request.targetAssetId,
      referenceName: request.referenceName,
      targetName: request.targetName,
      generatedAt: new Date().toISOString(),
      gridSize: result.stats.gridSize,
      sourceSamples: result.stats.sourceSamples,
    }, null, 2), { encoding: 'utf8', mode: 0o600 })
    return { path: destination, name: outputName, category: CACHE_CATEGORY, modelVersion: 'v1-256' }
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** AI 追色共用一个主进程队列，复制粘贴多张照片时不会并发启动模型任务。 */
export function generateReferenceMatchAiLut(
  settings: AppSettings,
  request: WorkspaceReferenceMatchAiLutRequest,
): Promise<WorkspaceReferenceMatchAiLutResult> {
  return enqueueAiLutGeneration(() => generateReferenceMatchAiLutInternal(settings, request))
}
