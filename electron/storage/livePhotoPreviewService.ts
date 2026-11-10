import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { localThumbnailUrl, safeName } from '../media/filePathUtils'
import { previewCacheDir } from './settingsService'
import type { PreviewResult } from '../../src/shared/types'

const previewTasks = new Map<string, Promise<PreviewResult>>()

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function extractEmbeddedLivePhotoVideo(livPath: string, destination: string): Promise<string | null> {
  const data = await fs.readFile(livPath)
  const ftypOffset = data.indexOf(Buffer.from('ftyp', 'ascii'))
  const mp4Offset = ftypOffset - 4
  if (ftypOffset < 4 || mp4Offset <= 0) return null

  const boxSize = data.readUInt32BE(mp4Offset)
  if (boxSize < 8 || boxSize > data.length - mp4Offset) return null

  await fs.mkdir(path.dirname(destination), { recursive: true })
  const partialPath = `${destination}.tmp`
  await fs.rm(partialPath, { force: true })
  await fs.writeFile(partialPath, data.subarray(mp4Offset))
  await fs.rename(partialPath, destination)
  return destination
}

async function extractEmbeddedLivePhotoImage(livPath: string, destination: string): Promise<string | null> {
  const data = await fs.readFile(livPath)
  const ftypOffset = data.indexOf(Buffer.from('ftyp', 'ascii'))
  const mp4Offset = ftypOffset - 4
  if (ftypOffset < 4 || mp4Offset <= 2) return null
  if (data[mp4Offset - 2] !== 0xff || data[mp4Offset - 1] !== 0xd9) return null

  const partialPath = `${destination}.tmp`
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.rm(partialPath, { force: true })
  await fs.writeFile(partialPath, data.subarray(0, mp4Offset))
  try {
    await fs.rename(partialPath, destination)
  } catch (error) {
    if (!(await fileExists(destination))) throw error
    await fs.rm(partialPath, { force: true })
  }
  return destination
}

async function extractPreview(source: string): Promise<PreviewResult> {
  const fileName = path.basename(source)
  const videoName = `${fileName}.live.mp4`
  const cacheDir = await previewCacheDir()
  await fs.mkdir(cacheDir, { recursive: true })
  if (!(await fileExists(source))) {
    return { fileName, kind: 'image', source: null, cachedPath: null, message: 'Live 图文件不存在' }
  }

  const sourceStats = await fs.stat(source)
  const sourceKey = createHash('sha256')
    .update(`${path.resolve(source)}\0${sourceStats.size}\0${sourceStats.mtimeMs}`)
    .digest('hex')
    .slice(0, 16)
  const embeddedLivePath = path.join(cacheDir, `${safeName(fileName)}.${sourceKey}.live.mp4`)

  if (await fileExists(embeddedLivePath)) {
    return { fileName: videoName, kind: 'video', source: localThumbnailUrl(embeddedLivePath), cachedPath: embeddedLivePath }
  }

  const extractedPath = await extractEmbeddedLivePhotoVideo(source, embeddedLivePath)
  if (!extractedPath) {
    return { fileName, kind: 'image', source: null, cachedPath: null, message: '没有在 Live 图中找到视频片段' }
  }

  return { fileName: videoName, kind: 'video', source: localThumbnailUrl(extractedPath), cachedPath: extractedPath }
}

/** 多个导出项目可能同时读取同一张 Live 图；共享提取任务，避免争用同一个临时文件。 */
export function previewLivePhoto(source: string): Promise<PreviewResult> {
  const livPath = source.startsWith('file:') ? fileURLToPath(source) : source
  const existingTask = previewTasks.get(livPath)
  if (existingTask) return existingTask

  const task = extractPreview(livPath)
  previewTasks.set(livPath, task)
  const clearTask = (): void => {
    if (previewTasks.get(livPath) === task) previewTasks.delete(livPath)
  }
  void task.then(clearTask, clearTask)
  return task
}

/** 从 Live 图中提取纯静态照片部分并缓存。 */
export async function extractLivePhotoImage(source: string): Promise<string> {
  const livePhotoPath = source.startsWith('file:') ? fileURLToPath(source) : source
  if (!(await fileExists(livePhotoPath))) throw new Error('Live 图文件不存在')

  const stats = await fs.stat(livePhotoPath)
  const sourceKey = createHash('sha256')
    .update(`${path.resolve(livePhotoPath)}\0${stats.size}\0${stats.mtimeMs}`)
    .digest('hex')
    .slice(0, 16)
  const cacheDir = await previewCacheDir()
  const imagePath = path.join(cacheDir, `${safeName(path.basename(livePhotoPath))}.${sourceKey}.live.jpg`)
  if (await fileExists(imagePath)) return imagePath

  const extractedPath = await extractEmbeddedLivePhotoImage(livePhotoPath, imagePath)
  if (!extractedPath) throw new Error('无法从 Live 图中提取静态照片')
  return extractedPath
}
