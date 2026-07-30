import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { subtitleTrackToSrt } from '../src/shared/subtitleTrack'
import type { WorkspaceSubtitleTrack } from '../src/shared/types'
import { safeName } from './filePathUtils'

interface SubtitleExportRequest {
  sourcePath: string
  track: WorkspaceSubtitleTrack
  range: { startMs: number; endMs: number }
}

export function register(): void {
  ipcMain.handle('workspace:exportSubtitlesSrt', async (event, request: SubtitleExportRequest) => {
    if (!request || typeof request.sourcePath !== 'string' || !path.isAbsolute(request.sourcePath)) throw new Error('源文件路径无效')
    const content = subtitleTrackToSrt(request.track, request.range)
    if (!content.trim()) throw new Error('当前范围内没有可导出的字幕')
    const sourceName = path.basename(request.sourcePath, path.extname(request.sourcePath)) || 'video'
    const options: Electron.SaveDialogOptions = {
      title: '导出字幕',
      defaultPath: path.join(path.dirname(request.sourcePath), `${safeName(sourceName)}.srt`),
      filters: [{ name: 'SRT 字幕', extensions: ['srt'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, { encoding: 'utf8', mode: 0o600 })
    return { path: result.filePath }
  })
}
