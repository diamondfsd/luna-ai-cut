import { ipcMain } from 'electron'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { prepareDownloadDirectory } from './downloadDirectoryService'
import { safeName } from './filePathUtils'
import { getSettings } from './fileService'
import { embedJpegSourceMetadata } from './exportSourceMetadata'

const MAX_EXPORT_CHUNK_BYTES = 8 * 1024 * 1024

interface ExportWriter {
  ownerId: number
  targetPath: string
  temporaryPath: string
  fileName: string
  tail: Promise<void>
}

const writers = new Map<string, ExportWriter>()
const watchedOwners = new Set<number>()
let openWriterTail = Promise.resolve()

function normalizedFileName(value: string): string {
  const name = safeName(path.basename(value)).replace(/^\.+/, '').trim()
  if (!name || name.length > 240) throw new Error('导出文件名无效')
  return name
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false)
}

function targetIsReserved(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  return [...writers.values()].some((writer) => path.resolve(writer.targetPath) === resolved)
}

function friendlyExportError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ENOSPC') return new Error('导出目录空间不足，请清理空间后重试')
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) {
    return new Error('导出目录不可写，请重新选择一个可用目录')
  }
  if (['ENOENT', 'ENODEV', 'EIO'].includes(code)) {
    return new Error('导出目录不可用，请确认存储设备已连接后重试')
  }
  return error instanceof Error && error.message ? error : new Error('导出失败，请检查导出目录后重试')
}

function suffixFileName(fileName: string, index: number): string {
  const extension = path.extname(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  return `${stem} (${index})${extension}`
}

async function uniqueTarget(
  directory: string,
  requestedName: string,
): Promise<{ fileName: string; filePath: string }> {
  const requestedPath = path.join(directory, requestedName)
  if (!await fileExists(requestedPath) && !targetIsReserved(requestedPath)) {
    return { fileName: requestedName, filePath: path.join(directory, requestedName) }
  }
  for (let index = 2; index < 1_000; index += 1) {
    const fileName = suffixFileName(requestedName, index)
    const filePath = path.join(directory, fileName)
    if (!await fileExists(filePath) && !targetIsReserved(filePath)) return { fileName, filePath }
  }
  const fileName = suffixFileName(requestedName, Date.now())
  return { fileName, filePath: path.join(directory, fileName) }
}

async function allowedExportDirectory(directory: string): Promise<string> {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请先选择导出目录')
  const configured = (await getSettings()).exportDir
  if (!configured || path.resolve(directory) !== path.resolve(configured)) {
    throw new Error('导出目录已变更，请重新选择')
  }
  return prepareDownloadDirectory(configured)
}

function requireWriter(writerId: string, ownerId: number): ExportWriter {
  const writer = writers.get(writerId)
  if (!writer || writer.ownerId !== ownerId) throw new Error('导出写入任务不存在')
  return writer
}

function enqueueWriter<T>(writerId: string, ownerId: number, operation: (writer: ExportWriter) => Promise<T>): Promise<T> {
  const writer = requireWriter(writerId, ownerId)
  const result = writer.tail.then(() => operation(writer))
  writer.tail = result.then(() => undefined, () => undefined)
  return result
}

function enqueueOpenWriter<T>(operation: () => Promise<T>): Promise<T> {
  const result = openWriterTail.then(operation)
  openWriterTail = result.then(() => undefined, () => undefined)
  return result
}

async function cleanupOwner(ownerId: number): Promise<void> {
  const owned = [...writers.entries()].filter(([, writer]) => writer.ownerId === ownerId)
  for (const [writerId, writer] of owned) {
    writers.delete(writerId)
    await writer.tail.catch(() => undefined)
    await rm(writer.temporaryPath, { force: true }).catch(() => undefined)
  }
}

export function register(): void {
  ipcMain.handle('freecut-export:open-writer', async (event, directory: string, requestedName: string) => {
    const ownerId = event.sender.id
    if (!watchedOwners.has(ownerId)) {
      watchedOwners.add(ownerId)
      event.sender.once('destroyed', () => {
        watchedOwners.delete(ownerId)
        void cleanupOwner(ownerId)
      })
    }

    return enqueueOpenWriter(async () => {
      try {
        const exportDirectory = await allowedExportDirectory(directory)
        await mkdir(exportDirectory, { recursive: true })
        const target = await uniqueTarget(exportDirectory, normalizedFileName(requestedName))
        const temporaryPath = path.join(
          exportDirectory,
          `.${target.fileName}.${process.pid}.${randomUUID()}.tmp`,
        )
        await writeFile(temporaryPath, Buffer.alloc(0), { flag: 'wx' })
        const writerId = randomUUID()
        writers.set(writerId, {
          ownerId,
          targetPath: target.filePath,
          temporaryPath,
          fileName: target.fileName,
          tail: Promise.resolve(),
        })
        return { writerId, filePath: target.filePath, fileName: target.fileName }
      } catch (error) {
        throw friendlyExportError(error)
      }
    })
  })

  ipcMain.handle('freecut-export:write-writer', (event, writerId: string, data: ArrayBuffer) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > MAX_EXPORT_CHUNK_BYTES) {
      throw new Error('导出数据块无效')
    }
    return enqueueWriter(writerId, event.sender.id, (writer) => (
      writeFile(writer.temporaryPath, Buffer.from(new Uint8Array(data)), { flag: 'a' })
    )).catch((error) => {
      throw friendlyExportError(error)
    })
  })

  ipcMain.handle('freecut-export:close-writer', async (event, writerId: string) => {
    const writer = requireWriter(writerId, event.sender.id)
    try {
      try {
        return await enqueueWriter(writerId, event.sender.id, async (current) => {
          await rename(current.temporaryPath, current.targetPath)
          return { filePath: current.targetPath, fileName: current.fileName }
        })
      } catch (error) {
        throw friendlyExportError(error)
      }
    } finally {
      writers.delete(writerId)
      await rm(writer.temporaryPath, { force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle('freecut-export:abort-writer', async (event, writerId: string) => {
    const writer = writers.get(writerId)
    if (!writer || writer.ownerId !== event.sender.id) return
    writers.delete(writerId)
    await writer.tail.catch(() => undefined)
    await rm(writer.temporaryPath, { force: true }).catch(() => undefined)
  })

  ipcMain.handle('freecut-export:embed-jpeg-source-metadata', async (_event, outputPath: string, sourcePath: string) => {
    if (typeof outputPath !== 'string' || typeof sourcePath !== 'string') throw new Error('图片来源信息无效')
    const exportDirectory = await allowedExportDirectory(path.dirname(outputPath))
    const resolvedOutputPath = path.resolve(outputPath)
    if (path.dirname(resolvedOutputPath) !== path.resolve(exportDirectory)) {
      throw new Error('导出文件路径无效')
    }
    return embedJpegSourceMetadata(resolvedOutputPath, sourcePath)
  })
}
