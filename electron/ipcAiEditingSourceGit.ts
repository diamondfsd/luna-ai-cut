import { app, ipcMain } from 'electron'
import { createAiEditingSourceGitApi } from './aiEditingSourceGitService'

export function register(): void {
  const sourceGit = createAiEditingSourceGitApi(app.getPath('userData'))
  ipcMain.handle('ai-editing-source-git:ensure', (_event, projectId, initialFiles) =>
    sourceGit.ensure(projectId, initialFiles),
  )
  ipcMain.handle('ai-editing-source-git:status', (_event, projectId) => sourceGit.status(projectId))
  ipcMain.handle('ai-editing-source-git:list', (_event, projectId, sourceDirectory) =>
    sourceGit.list(projectId, sourceDirectory),
  )
  ipcMain.handle('ai-editing-source-git:read', (_event, projectId, sourcePath) =>
    sourceGit.read(projectId, sourcePath),
  )
  ipcMain.handle('ai-editing-source-git:write', (_event, projectId, sourcePath, content) =>
    sourceGit.write(projectId, sourcePath, content),
  )
  ipcMain.handle('ai-editing-source-git:remove', (_event, projectId, sourcePath) =>
    sourceGit.remove(projectId, sourcePath),
  )
  ipcMain.handle('ai-editing-source-git:apply-changes', (_event, projectId, changes) =>
    sourceGit.applyChanges(projectId, changes),
  )
  ipcMain.handle('ai-editing-source-git:diff', (_event, projectId) => sourceGit.diff(projectId))
  ipcMain.handle('ai-editing-source-git:log', (_event, projectId, limit) =>
    sourceGit.log(projectId, limit),
  )
  ipcMain.handle('ai-editing-source-git:branches', (_event, projectId) =>
    sourceGit.branches(projectId),
  )
  ipcMain.handle('ai-editing-source-git:create-branch', (_event, projectId, name) =>
    sourceGit.createBranch(projectId, name),
  )
  ipcMain.handle('ai-editing-source-git:checkout', (_event, projectId, name) =>
    sourceGit.checkout(projectId, name),
  )
  ipcMain.handle('ai-editing-source-git:commit', (_event, projectId, message) =>
    sourceGit.commit(projectId, message),
  )
}
