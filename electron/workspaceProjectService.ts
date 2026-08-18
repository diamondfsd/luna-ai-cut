import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { WorkspaceMediaAsset, WorkspaceProject, WorkspaceProjectAsset, WorkspaceRemovalOperation } from '../src/shared/types'
import { normalizeSubtitleTrack } from '../src/shared/subtitleTrack'
import { fileSha256 } from './resumableDownloadService'

const PROJECTS_DIR = 'workspace-projects'
const PROJECT_FILE = 'project.json'
const MAX_PROJECT_ID_LENGTH = 100

const projectOperations = new Map<string, Promise<void>>()

function projectRoot(baseDir: string): string {
  return path.resolve(baseDir, PROJECTS_DIR)
}

function safeDirName(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project'
}

function validateProjectId(id: string): void {
  if (
    !id
    || id.length > MAX_PROJECT_ID_LENGTH
    || id === '.'
    || id === '..'
    || !/^[\w.-]+$/.test(id)
  ) {
    throw new Error('项目标识无效')
  }
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('项目目录无效')
  }
}

function projectDir(baseDir: string, id: string): string {
  validateProjectId(id)
  const root = projectRoot(baseDir)
  const directory = path.resolve(root, id)
  assertContained(root, directory)
  return directory
}

function projectJsonPath(baseDir: string, id: string): string {
  return path.join(projectDir(baseDir, id), PROJECT_FILE)
}

function removalDir(baseDir: string, projectId: string): string {
  return path.join(projectDir(baseDir, projectId), 'removal')
}

function resolvedRemovalPath(directory: string, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null
  const resolved = path.resolve(path.isAbsolute(candidate) ? candidate : path.join(path.dirname(directory), candidate))
  const relative = path.relative(directory, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return resolved
}

async function normalizeRemovalOperation(operation: WorkspaceRemovalOperation, directory: string): Promise<WorkspaceRemovalOperation | null> {
  if (!operation || typeof operation !== 'object' || typeof operation.id !== 'string') return null
  const resultPath = resolvedRemovalPath(directory, operation.resultPath)
  const maskPath = resolvedRemovalPath(directory, operation.maskPath)
  let failureReason: string | undefined
  let resultBytes = Number(operation.resultBytes) || undefined
  let maskBytes = Number(operation.maskBytes) || undefined
  let resultSha256 = typeof operation.resultSha256 === 'string' ? operation.resultSha256 : undefined
  let maskSha256 = typeof operation.maskSha256 === 'string' ? operation.maskSha256 : undefined
  if (!resultPath || !maskPath) {
    failureReason = '消除结果路径无效'
  } else {
    const [resultInfo, maskInfo] = await Promise.all([fs.stat(resultPath).catch(() => null), fs.stat(maskPath).catch(() => null)])
    if (!resultInfo?.isFile() || !maskInfo?.isFile()) {
      failureReason = '消除结果文件缺失'
    } else if ((resultBytes && resultBytes !== resultInfo.size) || (maskBytes && maskBytes !== maskInfo.size)) {
      failureReason = '消除结果文件大小异常'
    } else if (maskInfo.size !== Number(operation.maskWidth) * Number(operation.maskHeight)) {
      failureReason = '消除蒙版尺寸异常'
    } else {
      resultBytes = resultInfo.size
      maskBytes = maskInfo.size
      if (!resultSha256 || !maskSha256) {
        const [actualResultSha, actualMaskSha] = await Promise.all([fileSha256(resultPath), fileSha256(maskPath)])
        if (!actualResultSha || !actualMaskSha) failureReason = '消除结果文件校验失败'
        else {
          resultSha256 = actualResultSha
          maskSha256 = actualMaskSha
        }
      }
    }
  }
  return {
    ...operation,
    resultPath: resultPath ?? operation.resultPath,
    maskPath: maskPath ?? operation.maskPath,
    resultBytes,
    resultSha256,
    maskBytes,
    maskSha256,
    status: failureReason ? 'needs-regeneration' : operation.status === 'needs-regeneration' ? 'needs-regeneration' : 'ready',
    ...(failureReason ? { failureReason } : { failureReason: operation.failureReason }),
  }
}

async function normalizeRemovalPipelines(project: WorkspaceProject, projectDirectory: string): Promise<WorkspaceProject> {
  const directory = path.join(projectDirectory, 'removal')
  return {
    ...project,
    assets: await Promise.all(project.assets.map(async (asset) => {
      const subtitles = normalizeSubtitleTrack(asset.subtitles)
      if (!asset.removal?.operations) return { ...asset, ...(subtitles ? { subtitles } : {}) }
      const operations = (await Promise.all(asset.removal.operations.map((operation) => normalizeRemovalOperation(operation, directory))))
        .filter((operation): operation is WorkspaceRemovalOperation => operation !== null)
      return { ...asset, removal: { schemaVersion: 1, operations }, ...(subtitles ? { subtitles } : {}) }
    })),
  }
}

async function normalizeRawPreviewAssets(project: WorkspaceProject): Promise<WorkspaceProject> {
  const assets = await Promise.all(project.assets.map(async (asset) => {
    if (path.extname(asset.path).toLowerCase() !== '.dng') return asset
    const basePath = asset.path.slice(0, -path.extname(asset.path).length)
    for (const extension of ['.jpg', '.jpeg']) {
      const jpgPath = `${basePath}${extension}`
      try {
        if ((await fs.stat(jpgPath)).isFile()) return { ...asset, path: jpgPath, thumbnailUrl: undefined }
      } catch {
        // Try the next JPEG extension.
      }
    }
    return asset
  }))
  return { ...project, assets }
}

function removalReferences(project: WorkspaceProject | null): Set<string> {
  return new Set(project?.assets.flatMap((asset) => asset.removal?.operations.flatMap((operation) => [operation.resultPath, operation.maskPath]) ?? []) ?? [])
}

function createId(name: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeDirName(name)}`
}

async function ensureProjectDirectory(baseDir: string, projectId: string): Promise<string> {
  const root = projectRoot(baseDir)
  const directory = projectDir(baseDir, projectId)
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(directory, { recursive: true })

  const stats = await fs.lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('项目目录无效')

  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(directory)])
  assertContained(realRoot, realDirectory)
  if (path.dirname(realDirectory) !== realRoot) throw new Error('项目目录无效')
  return realDirectory
}

async function withProjectOperation<T>(
  baseDir: string,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = projectDir(baseDir, projectId)
  const previous = projectOperations.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  projectOperations.set(key, tail)
  try {
    return await result
  } finally {
    if (projectOperations.get(key) === tail) projectOperations.delete(key)
  }
}

function dedupeAssets(current: WorkspaceProject['assets'], assets: WorkspaceProjectAsset[]): WorkspaceProject['assets'] {
  const key = (asset: WorkspaceProjectAsset): string => {
    const trim = (asset.pipeline as { trim?: { startTime?: number; endTime?: number } } | undefined)?.trim
    return `${asset.path}\0${trim?.startTime ?? ''}\0${trim?.endTime ?? ''}`
  }
  const byPath = new Map(current.map((asset) => [key(asset), asset]))
  for (const asset of assets) {
    const assetKey = key(asset)
    const existing = byPath.get(assetKey)
    byPath.set(assetKey, existing ? { ...existing, ...asset } : asset)
  }
  return [...byPath.values()]
}

async function readProject(filePath: string): Promise<WorkspaceProject | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const project = JSON.parse(raw) as WorkspaceProject
    if (!project || !Array.isArray(project.assets) || typeof project.dir !== 'string') return null
    return normalizeRawPreviewAssets(await normalizeRemovalPipelines(project, path.dirname(filePath)))
  } catch {
    return null
  }
}

async function writeProjectUnlocked(baseDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  const directory = await ensureProjectDirectory(baseDir, project.id)
  const destination = path.join(directory, PROJECT_FILE)
  const temporary = path.join(
    directory,
    `.${PROJECT_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  )
  const serialized = `${JSON.stringify(project, null, 2)}\n`
  JSON.parse(serialized)

  try {
    await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
  return project
}

async function writeProject(baseDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  return withProjectOperation(baseDir, project.id, () => writeProjectUnlocked(baseDir, project))
}

export async function listWorkspaceProjects(baseDir: string): Promise<WorkspaceProject[]> {
  try {
    const entries = await fs.readdir(projectRoot(baseDir), { withFileTypes: true })
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readProject(projectJsonPath(baseDir, entry.name))),
    )
    return projects
      .filter((project): project is WorkspaceProject => Boolean(project))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  } catch {
    return []
  }
}

export async function createWorkspaceProject(
  baseDir: string,
  name: string,
  assets: WorkspaceProjectAsset[],
): Promise<WorkspaceProject> {
  const now = new Date().toISOString()
  const id = createId(name)
  const project: WorkspaceProject = {
    id,
    name: name.trim() || '未命名项目',
    dir: projectDir(baseDir, id),
    createdAt: now,
    updatedAt: now,
    assets: dedupeAssets([], assets),
  }
  return writeProject(baseDir, project)
}

export async function addAssetsToWorkspaceProject(
  baseDir: string,
  projectId: string,
  assets: WorkspaceMediaAsset[],
): Promise<WorkspaceProject> {
  return withProjectOperation(baseDir, projectId, async () => {
    const project = await readProject(projectJsonPath(baseDir, projectId))
    if (!project) throw new Error('项目不存在')
    const next: WorkspaceProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      assets: dedupeAssets(project.assets, assets),
    }
    return writeProjectUnlocked(baseDir, next)
  })
}

export async function saveWorkspaceProject(baseDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  const next = {
    ...project,
    dir: projectDir(baseDir, project.id),
    updatedAt: new Date().toISOString(),
  }
  return withProjectOperation(baseDir, project.id, async () => {
    const current = await readProject(projectJsonPath(baseDir, project.id))
    const saved = await writeProjectUnlocked(baseDir, next)
    const retained = removalReferences(saved)
    const removed = [...removalReferences(current)].filter((filePath) => !retained.has(filePath))
    await discardWorkspaceRemovalFiles(baseDir, project.id, removed)
    return saved
  })
}

export async function discardWorkspaceRemovalFiles(baseDir: string, projectId: string, filePaths: string[]): Promise<void> {
  const directory = removalDir(baseDir, projectId)
  await Promise.all(filePaths.map(async (filePath) => {
    const resolved = resolvedRemovalPath(directory, filePath)
    if (!resolved) return
    await fs.rm(resolved, { force: true }).catch(() => undefined)
  }))
}

export async function loadWorkspaceRemovalMask(baseDir: string, projectId: string, filePath: string, expectedBytes: number): Promise<ArrayBuffer> {
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 1_048_576) throw new Error('消除蒙版尺寸无效')
  const resolved = resolvedRemovalPath(removalDir(baseDir, projectId), filePath)
  if (!resolved || path.extname(resolved) !== '.mask') throw new Error('消除蒙版路径无效')
  const data = await fs.readFile(resolved)
  if (data.byteLength !== expectedBytes) throw new Error('消除蒙版文件损坏，请重新选择区域')
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export async function deleteWorkspaceProject(baseDir: string, projectId: string): Promise<void> {
  await withProjectOperation(baseDir, projectId, async () => {
    const dir = projectDir(baseDir, projectId)
    const stats = await fs.lstat(dir).catch(() => null)
    if (stats?.isSymbolicLink()) throw new Error('项目目录无效')
    await fs.rm(dir, { recursive: true, force: true })
  })
}

export async function renameWorkspaceProject(
  baseDir: string,
  projectId: string,
  newName: string,
): Promise<WorkspaceProject> {
  return withProjectOperation(baseDir, projectId, async () => {
    const project = await readProject(projectJsonPath(baseDir, projectId))
    if (!project) throw new Error('项目不存在')
    const next: WorkspaceProject = {
      ...project,
      name: newName.trim() || project.name,
      updatedAt: new Date().toISOString(),
    }
    return writeProjectUnlocked(baseDir, next)
  })
}
