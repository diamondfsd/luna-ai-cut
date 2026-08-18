import { dialog, ipcMain } from 'electron'

import {
  addSharedFiles,
  getLocalMediaShareEntries,
  getLocalMediaShareDirectories,
  getLocalMediaShareStatus,
  removeSharedFile,
  startLocalMediaShare,
  stopLocalMediaShare,
} from './localMediaShareService'
import { saveSettings } from './fileService'

export function register(): void {
  ipcMain.handle('local-media-share:status', () => getLocalMediaShareStatus())
  ipcMain.handle('local-media-share:start', () => startLocalMediaShare())
  ipcMain.handle('local-media-share:stop', () => stopLocalMediaShare())
  ipcMain.handle('local-media-share:directories', () => getLocalMediaShareDirectories())
  ipcMain.handle('local-media-share:entries', () => getLocalMediaShareEntries())
  ipcMain.handle('local-media-share:choose-directories', async () => {
    const current = await getLocalMediaShareDirectories()
    const result = await dialog.showOpenDialog({
      defaultPath: current[0],
      properties: ['openDirectory', 'multiSelections'],
      title: '选择手机共享目录',
      buttonLabel: '共享这些目录',
    })
    if (result.canceled || result.filePaths.length === 0) return current
    return saveSettings({ localMediaShareDirectories: [...new Set([...current, ...result.filePaths])] }).then((settings) => settings.localMediaShareDirectories ?? [])
  })
  ipcMain.handle('local-media-share:choose-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '选择手机共享文件',
      buttonLabel: '共享这些文件',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return addSharedFiles(result.filePaths)
  })
  ipcMain.handle('local-media-share:remove-directory', async (_event, directory: string) => {
    const current = await getLocalMediaShareDirectories()
    return saveSettings({ localMediaShareDirectories: current.filter((candidate) => candidate !== directory) }).then((settings) => settings.localMediaShareDirectories ?? [])
  })
  ipcMain.handle('local-media-share:add-files', (_event, filePaths: string[]) => addSharedFiles(filePaths))
  ipcMain.handle('local-media-share:remove-file', (_event, filePath: string) => removeSharedFile(filePath))
}
