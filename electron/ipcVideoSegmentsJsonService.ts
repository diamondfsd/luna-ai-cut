import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspaceVideoSegmentsExport } from '../src/shared/types'
import { safeName } from './filePathUtils'

function normalizeExport(data: WorkspaceVideoSegmentsExport): WorkspaceVideoSegmentsExport {
  if (!data || typeof data.sourcePath !== 'string' || !path.isAbsolute(data.sourcePath)) {
    throw new Error('源文件路径无效')
  }
  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    throw new Error('请先添加至少一个片段')
  }

  const segments = data.segments.map((segment) => {
    const startTime = Number(segment?.startTime)
    const endTime = Number(segment?.endTime)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime + 0.1) {
      throw new Error('片段时间范围无效')
    }
    return {
      note: typeof segment.note === 'string' ? segment.note.trim().slice(0, 200) : '',
      startTime,
      endTime,
    }
  }).sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)

  return { sourcePath: data.sourcePath, segments }
}

export function register(): void {
  ipcMain.handle('workspace:exportVideoSegmentsJson', async (event, data: WorkspaceVideoSegmentsExport) => {
    const output = normalizeExport(data)
    const sourceName = path.basename(output.sourcePath, path.extname(output.sourcePath)) || 'video'
    const options: Electron.SaveDialogOptions = {
      title: '导出片段 JSON',
      defaultPath: path.join(path.dirname(output.sourcePath), `${safeName(sourceName)}_segments.json`),
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null

    await writeFile(result.filePath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return { path: result.filePath }
  })
}
