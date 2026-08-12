import { ipcMain } from 'electron'
import { createAiEditingSourceGitApi } from './aiEditingSourceGitService'
import { currentBaseDir } from './settingsService'

type SourceGitApi = ReturnType<typeof createAiEditingSourceGitApi>

let sourceGitBaseDir = ''
let sourceGit: SourceGitApi | null = null

function sourceGitApi(): SourceGitApi {
  const baseDir = currentBaseDir()
  if (!sourceGit || sourceGitBaseDir !== baseDir) {
    sourceGitBaseDir = baseDir
    sourceGit = createAiEditingSourceGitApi(baseDir)
  }
  return sourceGit
}

export function register(): void {
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
  ipcMain.handle('ai-editing-source-git:commit', (_event, projectId, message, sourcePaths) =>
    sourceGitApi().commit(projectId, message, sourcePaths),
  )
}
