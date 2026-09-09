import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { WorkspaceMediaAsset, WorkspaceProject, WorkspaceProjectAsset } from '../../../src/shared/types'

export const AI_EDITOR_PROJECTS_DIR = 'ai-editor-projects'

const LEGACY_PROJECTS_DIR = 'workspace-projects'
const PROJECT_FILE = 'project.json'
const EDITOR_DIR = 'editor'
const EDITOR_FILE = 'openreel.json'
const MAX_PROJECT_ID_LENGTH = 100

const projectOperations = new Map<string, Promise<void>>()
const legacyMigrations = new Map<string, Promise<void>>()

function projectRoot(baseDir: string): string {
  return path.resolve(baseDir, AI_EDITOR_PROJECTS_DIR)
}

function legacyProjectRoot(baseDir: string): string {
  return path.resolve(baseDir, LEGACY_PROJECTS_DIR)
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

function editorDocumentPath(baseDir: string, id: string): string {
  return path.join(projectDir(baseDir, id), EDITOR_DIR, EDITOR_FILE)
}

function createId(name: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeDirName(name)}`
}

function dedupeAssets(assets: WorkspaceProjectAsset[]): WorkspaceProjectAsset[] {
  const byPath = new Map<string, WorkspaceProjectAsset>()
  for (const asset of assets) {
    const trim = (asset.pipeline as { trim?: { startTime?: number; endTime?: number } } | undefined)?.trim
    const key = `${asset.path}\0${trim?.startTime ?? ''}\0${trim?.endTime ?? ''}`
    const existing = byPath.get(key)
    byPath.set(key, existing ? { ...existing, ...asset } : asset)
  }
  return [...byPath.values()]
}

async function readProject(filePath: string): Promise<WorkspaceProject | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const project = JSON.parse(raw) as WorkspaceProject
    if (
      !project
      || typeof project.id !== 'string'
      || typeof project.name !== 'string'
      || typeof project.dir !== 'string'
      || typeof project.createdAt !== 'string'
      || typeof project.updatedAt !== 'string'
      || !Array.isArray(project.assets)
    ) return null
    return project
  } catch {
    return null
  }
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

function validateEditorDocument(content: string): void {
  if (typeof content !== 'string' || content.trim().length === 0) throw new Error('编辑文档为空')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('编辑文档格式无效')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('编辑文档格式无效')
  const candidate = parsed as Record<string, unknown>
  const project = candidate.project && typeof candidate.project === 'object'
    ? candidate.project as Record<string, unknown>
    : candidate
  if (
    typeof project.id !== 'string'
    || typeof project.name !== 'string'
    || !project.mediaLibrary
    || typeof project.mediaLibrary !== 'object'
    || !project.timeline
    || typeof project.timeline !== 'object'
  ) throw new Error('编辑文档缺少项目内容')
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function migrateLegacyProject(baseDir: string, directoryName: string): Promise<void> {
  const source = path.join(legacyProjectRoot(baseDir), directoryName)
  const project = await readProject(path.join(source, PROJECT_FILE))
  if (!project || project.id !== directoryName) return

  try {
    const editorStats = await fs.lstat(path.join(source, EDITOR_DIR, EDITOR_FILE))
    if (!editorStats.isFile() || editorStats.isSymbolicLink()) return
    const sourceStats = await fs.lstat(source)
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) return
  } catch {
    return
  }

  const destination = projectDir(baseDir, project.id)
  if (await fs.lstat(destination).then(() => true, () => false)) return

  try {
    await fs.mkdir(projectRoot(baseDir), { recursive: true })
    await fs.rename(source, destination)
    await writeProjectUnlocked(baseDir, { ...project, dir: destination })
  } catch (error) {
    await fs.rename(destination, source).catch(() => undefined)
    if (!isMissingFile(error)) throw error
  }
}

async function migrateLegacyProjectsUnlocked(baseDir: string): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(legacyProjectRoot(baseDir), { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => migrateLegacyProject(baseDir, entry.name)))
}

async function ensureLegacyProjectsMigrated(baseDir: string): Promise<void> {
  const key = path.resolve(baseDir)
  const previous = legacyMigrations.get(key)
  if (previous) return previous
  const migration = migrateLegacyProjectsUnlocked(baseDir)
  legacyMigrations.set(key, migration)
  try {
    await migration
  } finally {
    if (legacyMigrations.get(key) === migration) legacyMigrations.delete(key)
  }
}

export interface AiEditorProjectSnapshot {
  projectId: string
  projectName: string
  editorDocument: string | null
}

export async function loadAiEditorProject(baseDir: string, projectId: string): Promise<AiEditorProjectSnapshot> {
  await ensureLegacyProjectsMigrated(baseDir)
  const project = await readProject(projectJsonPath(baseDir, projectId))
  if (!project) throw new Error('项目不存在')

  let editorDocument: string | null = null
  try {
    editorDocument = await fs.readFile(editorDocumentPath(baseDir, projectId), 'utf8')
    validateEditorDocument(editorDocument)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }

  return { projectId: project.id, projectName: project.name, editorDocument }
}

export async function saveAiEditorProject(
  baseDir: string,
  projectId: string,
  editorDocument: string,
): Promise<void> {
  validateEditorDocument(editorDocument)
  await ensureLegacyProjectsMigrated(baseDir)
  await withProjectOperation(baseDir, projectId, async () => {
    const project = await readProject(projectJsonPath(baseDir, projectId))
    if (!project) throw new Error('项目不存在')
    const directory = await ensureProjectDirectory(baseDir, projectId)
    const editorDirectory = path.join(directory, EDITOR_DIR)
    await fs.mkdir(editorDirectory, { recursive: true })
    const destination = path.join(editorDirectory, EDITOR_FILE)
    const temporary = path.join(
      editorDirectory,
      `.${EDITOR_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
    )
    const serialized = `${editorDocument.trim()}\n`
    try {
      await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, destination)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }

    await writeProjectUnlocked(baseDir, { ...project, updatedAt: new Date().toISOString() })
  })
}

export async function listAiEditorProjects(baseDir: string): Promise<WorkspaceProject[]> {
  await ensureLegacyProjectsMigrated(baseDir)
  try {
    const entries = await fs.readdir(projectRoot(baseDir), { withFileTypes: true })
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const project = await readProject(projectJsonPath(baseDir, entry.name))
          return project?.id === entry.name ? project : null
        }),
    )
    return projects
      .filter((project): project is WorkspaceProject => Boolean(project))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  } catch {
    return []
  }
}

export async function createAiEditorProject(
  baseDir: string,
  name: string,
  assets: WorkspaceMediaAsset[] = [],
): Promise<WorkspaceProject> {
  await ensureLegacyProjectsMigrated(baseDir)
  const now = new Date().toISOString()
  const id = createId(name)
  const project: WorkspaceProject = {
    id,
    name: name.trim() || '未命名项目',
    dir: projectDir(baseDir, id),
    createdAt: now,
    updatedAt: now,
    assets: dedupeAssets(assets),
  }
  return withProjectOperation(baseDir, id, () => writeProjectUnlocked(baseDir, project))
}

export async function deleteAiEditorProject(baseDir: string, projectId: string): Promise<void> {
  await ensureLegacyProjectsMigrated(baseDir)
  await withProjectOperation(baseDir, projectId, async () => {
    const directory = projectDir(baseDir, projectId)
    const stats = await fs.lstat(directory).catch(() => null)
    if (stats?.isSymbolicLink()) throw new Error('项目目录无效')
    await fs.rm(directory, { recursive: true, force: true })
  })
}

export async function renameAiEditorProject(
  baseDir: string,
  projectId: string,
  newName: string,
): Promise<WorkspaceProject> {
  await ensureLegacyProjectsMigrated(baseDir)
  return withProjectOperation(baseDir, projectId, async () => {
    const project = await readProject(projectJsonPath(baseDir, projectId))
    if (!project) throw new Error('项目不存在')
    return writeProjectUnlocked(baseDir, {
      ...project,
      name: newName.trim() || project.name,
      updatedAt: new Date().toISOString(),
    })
  })
}
