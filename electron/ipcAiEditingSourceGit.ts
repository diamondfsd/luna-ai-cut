import { ipcMain } from 'electron'
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import { createAiEditingSourceGitApi } from './aiEditingSourceGitService'
import { currentBaseDir } from './settingsService'

type SourceGitApi = ReturnType<typeof createAiEditingSourceGitApi>

let sourceGitBaseDir = ''
let sourceGit: SourceGitApi | null = null

type SourceWatcher = { close: () => void }

const sourceWatchers = new Map<string, SourceWatcher>()

function watchKey(senderId: number, projectId: string): string {
  return `${senderId}:${projectId}`
}

function isManagedSourcePath(sourcePath: string): boolean {
  return sourcePath === 'manifest.json' ||
    sourcePath.startsWith('sequences/') ||
    sourcePath.startsWith('components/')
}

function createSourceWatcher(root: string, onChanged: (paths: string[]) => void): SourceWatcher {
  const watchers = new Map<string, nodeFs.FSWatcher>()
  const pendingPaths = new Set<string>()
  let pendingUnknownPath = false
  let flushTimer: NodeJS.Timeout | undefined
  let closed = false

  const flush = () => {
    flushTimer = undefined
    if (closed) return
    const paths = pendingUnknownPath ? [] : [...pendingPaths].sort()
    pendingPaths.clear()
    pendingUnknownPath = false
    onChanged(paths)
  }

  const queueChange = (sourcePath?: string) => {
    if (closed) return
    if (sourcePath) {
      if (!isManagedSourcePath(sourcePath)) return
      pendingPaths.add(sourcePath)
    } else {
      pendingUnknownPath = true
    }
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flush, 180)
  }

  const removeWatchersUnder = (directory: string) => {
    for (const [watchedDirectory, watcher] of watchers) {
      if (watchedDirectory === directory || watchedDirectory.startsWith(`${directory}${path.sep}`)) {
        watcher.close()
        watchers.delete(watchedDirectory)
      }
    }
  }

  const watchDirectory = (directory: string) => {
    if (closed || watchers.has(directory)) return

    let entries: nodeFs.Dirent[]
    try {
      entries = nodeFs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }

    try {
      const watcher = nodeFs.watch(directory, { persistent: false }, (_eventType, filename) => {
        if (closed) return
        const name = filename?.toString()
        if (!name) {
          queueChange()
          return
        }

        const target = path.join(directory, name)
        const relative = path.relative(root, target).split(path.sep).join('/')
        try {
          const stat = nodeFs.statSync(target)
          if (stat.isDirectory()) watchDirectory(target)
          else queueChange(relative)
        } catch {
          removeWatchersUnder(target)
          queueChange(relative)
        }
      })
      watcher.on('error', () => {
        watcher.close()
        watchers.delete(directory)
      })
      watchers.set(directory, watcher)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name === '.git' || !entry.isDirectory()) continue
      watchDirectory(path.join(directory, entry.name))
    }
  }

  watchDirectory(root)

  return {
    close: () => {
      if (closed) return
      closed = true
      if (flushTimer) clearTimeout(flushTimer)
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
      pendingPaths.clear()
    },
  }
}

function stopSourceWatcher(senderId: number, projectId: string): void {
  const key = watchKey(senderId, projectId)
  sourceWatchers.get(key)?.close()
  sourceWatchers.delete(key)
}

function sourceGitApi(): SourceGitApi {
  const baseDir = currentBaseDir()
  if (!sourceGit || sourceGitBaseDir !== baseDir) {
    sourceGitBaseDir = baseDir
    sourceGit = createAiEditingSourceGitApi(baseDir)
  }
  return sourceGit
}

export function register(): void {
  ipcMain.handle('ai-editing-source-git:root', (_event, projectId) => sourceGitApi().root(projectId))
  ipcMain.handle('ai-editing-source-git:watch', async (event, projectId: string) => {
    stopSourceWatcher(event.sender.id, projectId)
    const root = await sourceGitApi().root(projectId)
    const watcher = createSourceWatcher(root, (paths) => {
      if (event.sender.isDestroyed()) {
        stopSourceWatcher(event.sender.id, projectId)
        return
      }
      event.sender.send('ai-editing-source-git:changed', { projectId, paths })
    })
    const key = watchKey(event.sender.id, projectId)
    sourceWatchers.set(key, watcher)
    event.sender.once('destroyed', () => {
      if (sourceWatchers.get(key) === watcher) stopSourceWatcher(event.sender.id, projectId)
    })
  })
  ipcMain.handle('ai-editing-source-git:unwatch', (event, projectId: string) => {
    stopSourceWatcher(event.sender.id, projectId)
  })
  ipcMain.handle('ai-editing-source-git:ensure', (_event, projectId, initialFiles) =>
    sourceGitApi().ensure(projectId, initialFiles),
  )
  ipcMain.handle('ai-editing-source-git:status', (_event, projectId) => sourceGitApi().status(projectId))
  ipcMain.handle('ai-editing-source-git:list', (_event, projectId, sourceDirectory) =>
    sourceGitApi().list(projectId, sourceDirectory),
  )
  ipcMain.handle('ai-editing-source-git:read', (_event, projectId, sourcePath) =>
    sourceGitApi().read(projectId, sourcePath),
  )
  ipcMain.handle('ai-editing-source-git:create', (_event, projectId, sourcePath, content) =>
    sourceGitApi().create(projectId, sourcePath, content),
  )
  ipcMain.handle('ai-editing-source-git:replace', (_event, projectId, input) =>
    sourceGitApi().replace(projectId, input),
  )
  ipcMain.handle('ai-editing-source-git:write', (_event, projectId, sourcePath, content) =>
    sourceGitApi().write(projectId, sourcePath, content),
  )
  ipcMain.handle('ai-editing-source-git:remove', (_event, projectId, sourcePath, expectedRevision) =>
    sourceGitApi().remove(projectId, sourcePath, expectedRevision),
  )
  ipcMain.handle('ai-editing-source-git:apply-changes', (_event, projectId, changes) =>
    sourceGitApi().applyChanges(projectId, changes),
  )
  ipcMain.handle('ai-editing-source-git:diff', (_event, projectId) => sourceGitApi().diff(projectId))
  ipcMain.handle('ai-editing-source-git:log', (_event, projectId, limit) =>
    sourceGitApi().log(projectId, limit),
  )
  ipcMain.handle('ai-editing-source-git:branches', (_event, projectId) =>
    sourceGitApi().branches(projectId),
  )
  ipcMain.handle('ai-editing-source-git:create-branch', (_event, projectId, name) =>
    sourceGitApi().createBranch(projectId, name),
  )
  ipcMain.handle('ai-editing-source-git:checkout', (_event, projectId, name) =>
    sourceGitApi().checkout(projectId, name),
  )
  ipcMain.handle('ai-editing-source-git:reset-to-initial', (_event, projectId) =>
    sourceGitApi().resetToInitial(projectId),
  )
  ipcMain.handle('ai-editing-source-git:commit', (_event, projectId, message, sourcePaths) =>
    sourceGitApi().commit(projectId, message, sourcePaths),
  )
}
