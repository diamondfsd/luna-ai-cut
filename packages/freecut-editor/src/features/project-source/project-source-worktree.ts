import type { Project } from '@freecut/types/project'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import {
  PROJECT_SOURCE_VERSION,
  projectFromSourceFiles,
  projectToSourceFiles,
} from './project-source-codec'

type SourceBridge = NonNullable<ReturnType<typeof getEmbeddedHostBridge>['editingSourceGit']>

function isManagedProjectSource(path: string): boolean {
  return (
    path === 'manifest.json' ||
    path.startsWith('sequences/') ||
    path.startsWith('components/')
  )
}

async function listFiles(bridge: SourceBridge, projectId: string): Promise<string[]> {
  const files: string[] = []
  const pending = ['']
  while (pending.length > 0) {
    const directory = pending.shift()!
    for (const entry of await bridge.list(projectId, directory)) {
      if (entry.type === 'directory') pending.push(entry.path)
      else files.push(entry.path)
    }
  }
  return files.sort()
}

async function readFiles(
  bridge: SourceBridge,
  projectId: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      paths.map(async (path) => [path, await bridge.read(projectId, path)] as const),
    ),
  )
}

async function applyProjectFiles(
  bridge: SourceBridge,
  projectId: string,
  desired: Readonly<Record<string, string>>,
): Promise<void> {
  const paths = await listFiles(bridge, projectId)
  const current = await readFiles(
    bridge,
    projectId,
    paths.filter(isManagedProjectSource),
  )
  const changes: Array<{
    path: string
    content: string | null
    expectedContent: string | null
  }> = Object.entries(desired).flatMap(([path, content]) => {
    const previous = current.get(path)
    return previous === content
      ? []
      : [{ path, content, expectedContent: previous ?? null }]
  })
  for (const [path, content] of current) {
    if (!(path in desired)) changes.push({ path, content: null, expectedContent: content })
  }
  if (changes.length > 0) await bridge.applyChanges(projectId, changes)
}

function sourceVersion(content: string): number | null {
  try {
    const value = JSON.parse(content) as { version?: unknown }
    return typeof value.version === 'number' ? value.version : null
  } catch {
    return null
  }
}

export async function ensureProjectSource(project: Project): Promise<boolean> {
  const bridge = getEmbeddedHostBridge().editingSourceGit
  if (!bridge) return false
  const desired = projectToSourceFiles(project)
  const ensured = await bridge.ensure(project.id, desired)
  if (ensured.created) return true

  const manifest = await bridge.read(project.id, 'manifest.json')
  if (sourceVersion(manifest) !== PROJECT_SOURCE_VERSION) {
    throw new Error('项目源码格式已经更新，请删除旧工程后重新创建。')
  }
  return true
}

export async function writeProjectSource(project: Project): Promise<boolean> {
  const bridge = getEmbeddedHostBridge().editingSourceGit
  if (!bridge) return false
  await ensureProjectSource(project)
  await applyProjectFiles(bridge, project.id, projectToSourceFiles(project))
  return true
}

export async function readProjectSource(projectId: string): Promise<Project | null> {
  const bridge = getEmbeddedHostBridge().editingSourceGit
  if (!bridge) return null
  return projectFromSourceFiles({
    read: (path) => bridge.read(projectId, path),
    list: (directory) => bridge.list(projectId, directory),
  })
}
