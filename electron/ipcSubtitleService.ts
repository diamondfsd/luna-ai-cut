import { app, dialog, ipcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpenCutSubtitleTranscriptionRequest, WorkspaceSubtitleFontAsset, WorkspaceSubtitleTranscriptionRequest } from '../src/shared/types'
import { transcribeVideo } from './subtitleTranscriptionService'

const tasks = new Map<string, AbortController>()
const MAX_FONT_BYTES = 30 * 1024 * 1024

function encodeFloat32Wave(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.byteLength
  const output = Buffer.allocUnsafe(44 + dataBytes)
  output.write('RIFF', 0)
  output.writeUInt32LE(36 + dataBytes, 4)
  output.write('WAVE', 8)
  output.write('fmt ', 12)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(3, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(sampleRate, 24)
  output.writeUInt32LE(sampleRate * 4, 28)
  output.writeUInt16LE(4, 32)
  output.writeUInt16LE(32, 34)
  output.write('data', 36)
  output.writeUInt32LE(dataBytes, 40)
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(output, 44)
  return output
}

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

  ipcMain.handle('workspace:transcribeOpenCutAudio', async (event, request: OpenCutSubtitleTranscriptionRequest) => {
    if (tasks.size > 0) throw new Error('已有字幕识别任务正在进行')
    if (!(request.samples instanceof Float32Array) || request.samples.length === 0) throw new Error('没有可识别的音频')
    if (!Number.isInteger(request.sampleRate) || request.sampleRate < 8_000 || request.sampleRate > 192_000) throw new Error('音频采样率无效')

    const controller = new AbortController()
    tasks.set(request.requestId, controller)
    const abort = (): void => controller.abort()
    event.sender.once('destroyed', abort)
    const tempPath = path.join(app.getPath('temp'), `luna-opencut-${request.requestId}.wav`)
    try {
      await writeFile(tempPath, encodeFloat32Wave(request.samples, request.sampleRate))
      return await transcribeVideo({
        requestId: request.requestId,
        filePath: tempPath,
        startMs: 0,
        endMs: request.samples.length / request.sampleRate * 1_000,
        language: request.language,
      }, controller.signal, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('workspace:subtitle-progress', progress)
      })
    } finally {
      event.sender.removeListener('destroyed', abort)
      tasks.delete(request.requestId)
      await rm(tempPath, { force: true }).catch(() => undefined)
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
