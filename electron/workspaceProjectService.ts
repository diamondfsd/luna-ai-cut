import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { WorkspaceMediaAsset, WorkspaceProject } from '../src/shared/types'

const PROJECTS_DIR = 'workspace-projects'
const PROJECT_FILE = 'project.json'

function projectRoot(localResourcesDir: string): string {
  return path.join(localResourcesDir, PROJECTS_DIR)
}

function safeDirName(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project'
}

function projectDir(localResourcesDir: string, id: string): string {
  return path.join(projectRoot(localResourcesDir), id)
}

function projectJsonPath(localResourcesDir: string, id: string): string {
  return path.join(projectDir(localResourcesDir, id), PROJECT_FILE)
}

function createId(name: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeDirName(name)}`
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

async function writeProject(localResourcesDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  await fs.mkdir(projectDir(localResourcesDir, project.id), { recursive: true })
  await fs.writeFile(projectJsonPath(localResourcesDir, project.id), JSON.stringify(project, null, 2), 'utf8')
  return project
}

export async function listWorkspaceProjects(localResourcesDir: string): Promise<WorkspaceProject[]> {
  try {
    const entries = await fs.readdir(projectRoot(localResourcesDir), { withFileTypes: true })
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readProject(projectJsonPath(localResourcesDir, entry.name))),
    )
    return projects
      .filter((project): project is WorkspaceProject => Boolean(project))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  } catch {
    return []
  }
}

export async function createWorkspaceProject(
  localResourcesDir: string,
  name: string,
  assets: WorkspaceMediaAsset[],
): Promise<WorkspaceProject> {
  const now = new Date().toISOString()
  const id = createId(name)
  const project: WorkspaceProject = {
    id,
    name: name.trim() || '未命名项目',
    dir: projectDir(localResourcesDir, id),
    createdAt: now,
    updatedAt: now,
    assets: dedupeAssets([], assets),
  }
  return writeProject(localResourcesDir, project)
}

export async function addAssetsToWorkspaceProject(
  localResourcesDir: string,
  projectId: string,
  assets: WorkspaceMediaAsset[],
): Promise<WorkspaceProject> {
  const project = await readProject(projectJsonPath(localResourcesDir, projectId))
  if (!project) throw new Error('项目不存在')
  const next: WorkspaceProject = {
    ...project,
    updatedAt: new Date().toISOString(),
    assets: dedupeAssets(project.assets, assets),
  }
  return writeProject(localResourcesDir, next)
}

export async function saveWorkspaceProject(localResourcesDir: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  const next = {
    ...project,
    dir: projectDir(localResourcesDir, project.id),
    updatedAt: new Date().toISOString(),
  }
  return writeProject(localResourcesDir, next)
}
