import { app, dialog, ipcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceSubtitleFontAsset, WorkspaceSubtitleTranscriptionRequest } from '../../src/shared/types'
import { transcribeVideo } from '../features/subtitles/subtitleTranscriptionService'

const tasks = new Map<string, AbortController>()
const MAX_FONT_BYTES = 30 * 1024 * 1024

function validFontHeader(bytes: Buffer, extension: string): boolean {
  if (bytes.length < 4) return false
  if (extension === '.otf') return bytes.subarray(0, 4).toString('ascii') === 'OTTO'
  return extension === '.ttf' && (
    bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))
    || bytes.subarray(0, 4).toString('ascii') === 'true'
  )
}

async function chooseSubtitleFont(): Promise<WorkspaceSubtitleFontAsset | null> {
  const result = await dialog.showOpenDialog({
    title: '选择字幕字体',
    properties: ['openFile'],
    filters: [{ name: '桌面字体', extensions: ['otf', 'ttf'] }],
  })
  const sourcePath = result.filePaths[0]
  if (result.canceled || !sourcePath) return null
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension !== '.otf' && extension !== '.ttf') throw new Error('请选择 OTF 或 TTF 字体文件')
  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error('无法读取这个字体文件')
  if (sourceStat.size > MAX_FONT_BYTES) throw new Error('字体文件不能超过 30 MB')
  const bytes = await readFile(sourcePath)
  if (!validFontHeader(bytes, extension)) throw new Error('字体文件格式无效，请选择标准 OTF 或 TTF 桌面字体')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const fontDirectory = path.join(app.getPath('userData'), 'subtitle-fonts')
  const destination = path.join(fontDirectory, `${sha256}${extension}`)
  await mkdir(fontDirectory, { recursive: true })
  const destinationExists = await stat(destination)
    .then((destinationStat) => destinationStat.isFile())
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
  if (!destinationExists) {
    const staging = path.join(fontDirectory, `.${sha256}.${randomUUID()}.staging`)
    try {
      await copyFile(sourcePath, staging)
      await rename(staging, destination).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        await rm(staging, { force: true })
      })
    } catch (error) {
      await rm(staging, { force: true })
      throw error
    }
  }
  return {
    fileName: path.basename(sourcePath),
    filePath: destination,
    format: extension.slice(1) as WorkspaceSubtitleFontAsset['format'],
  }
}

export function register(): void {
  ipcMain.handle('workspace:transcribeSubtitles', async (event, request: WorkspaceSubtitleTranscriptionRequest) => {
    if (tasks.size > 0) throw new Error('已有字幕识别任务正在进行')
    const controller = new AbortController()
    tasks.set(request.requestId, controller)
    const abort = (): void => controller.abort()
    event.sender.once('destroyed', abort)
    try {
      return await transcribeVideo(request, controller.signal, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('workspace:subtitle-progress', progress)
      })
    } finally {
      event.sender.removeListener('destroyed', abort)
      tasks.delete(request.requestId)
    }
  })

  ipcMain.handle('workspace:cancelSubtitleTranscription', (_event, requestId: string) => {
    tasks.get(requestId)?.abort()
  })

  ipcMain.handle('workspace:chooseSubtitleFont', () => chooseSubtitleFont())

  app.once('before-quit', () => {
    for (const controller of tasks.values()) controller.abort()
  })
}
