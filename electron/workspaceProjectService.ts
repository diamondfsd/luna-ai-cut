import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../src/shared/types'

const PROJECTS_DIR = 'workspace-projects'
const PROJECT_FILE = 'project.json'
const MAX_PROJECT_ID_LENGTH = 100

const projectOperations = new Map<string, Promise<void>>()

function projectRoot(downloadDir: string): string {
  return path.resolve(downloadDir, PROJECTS_DIR)
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

function projectDir(downloadDir: string, id: string): string {
  validateProjectId(id)
  const root = projectRoot(downloadDir)
  const directory = path.resolve(root, id)
  assertContained(root, directory)
  return directory
}

function projectJsonPath(downloadDir: string, id: string): string {
  return path.join(projectDir(downloadDir, id), PROJECT_FILE)
}

function createId(name: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeDirName(name)}`
}

async function ensureProjectDirectory(downloadDir: string, projectId: string): Promise<string> {
  const root = projectRoot(downloadDir)
  const directory = projectDir(downloadDir, projectId)
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
  downloadDir: string,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = projectDir(downloadDir, projectId)
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

function dedupeAssets(current: WorkspaceProject['assets'], assets: WorkspaceMediaAsset[]): WorkspaceProject['assets'] {
  const byPath = new Map(current.map((asset) => [asset.path, asset]))
  for (const asset of assets) {
    const existing = byPath.get(asset.path)
    byPath.set(asset.path, existing ? { ...existing, ...asset } : asset)
  }
  return [...byPath.values()]
}

async function readProject(filePath: string): Promise<WorkspaceProject | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as WorkspaceProject
  } catch {
    return null
  }
}

async function writeProjectUnlocked(downloadDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  const directory = await ensureProjectDirectory(downloadDir, project.id)
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

async function writeProject(downloadDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  return withProjectOperation(downloadDir, project.id, () => writeProjectUnlocked(downloadDir, project))
}

export async function listWorkspaceProjects(downloadDir: string): Promise<WorkspaceProject[]> {
  try {
    const entries = await fs.readdir(projectRoot(downloadDir), { withFileTypes: true })
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readProject(projectJsonPath(downloadDir, entry.name))),
    )
    return projects
      .filter((project): project is WorkspaceProject => Boolean(project))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  } catch {
    return []
  }
}

export async function createWorkspaceProject(
  downloadDir: string,
  name: string,
  assets: WorkspaceMediaAsset[],
): Promise<WorkspaceProject> {
  const now = new Date().toISOString()
  const id = createId(name)
  const project: WorkspaceProject = {
    id,
    name: name.trim() || '未命名项目',
    dir: projectDir(downloadDir, id),
    createdAt: now,
    updatedAt: now,
    assets: dedupeAssets([], assets),
  }
  return writeProject(downloadDir, project)
}

export async function addAssetsToWorkspaceProject(
  downloadDir: string,
  projectId: string,
  assets: WorkspaceMediaAsset[],
): Promise<WorkspaceProject> {
  return withProjectOperation(downloadDir, projectId, async () => {
    const project = await readProject(projectJsonPath(downloadDir, projectId))
    if (!project) throw new Error('项目不存在')
    const next: WorkspaceProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      assets: dedupeAssets(project.assets, assets),
    }
    return writeProjectUnlocked(downloadDir, next)
  })
}

export async function saveWorkspaceProject(downloadDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  const next = {
    ...project,
    dir: projectDir(downloadDir, project.id),
    updatedAt: new Date().toISOString(),
  }
  return writeProject(downloadDir, next)
}

export async function deleteWorkspaceProject(downloadDir: string, projectId: string): Promise<void> {
  await withProjectOperation(downloadDir, projectId, async () => {
    const dir = projectDir(downloadDir, projectId)
    const stats = await fs.lstat(dir).catch(() => null)
    if (stats?.isSymbolicLink()) throw new Error('项目目录无效')
    await fs.rm(dir, { recursive: true, force: true })
  })
}

export async function renameWorkspaceProject(
  downloadDir: string,
  projectId: string,
  newName: string,
): Promise<WorkspaceProject> {
  return withProjectOperation(downloadDir, projectId, async () => {
    const project = await readProject(projectJsonPath(downloadDir, projectId))
    if (!project) throw new Error('项目不存在')
    const next: WorkspaceProject = {
      ...project,
      name: newName.trim() || project.name,
      updatedAt: new Date().toISOString(),
    }
    return writeProjectUnlocked(downloadDir, next)
  })
}
