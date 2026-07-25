import { app, dialog, nativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import type { CustomWatermarkAsset } from '../src/shared/types'
import { addCustomWatermarkAsset } from '../src/shared/watermarkLibrary'
import { getSettings, saveSettings } from './settingsService'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MIN_IMAGE_SIDE = 32
const MAX_IMAGE_SIDE = 8192
const FORMAT_BY_EXTENSION: Record<string, CustomWatermarkAsset['format']> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
}

function assetDirectory(): string {
  return path.join(app.getPath('userData'), 'watermarks')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function importCustomWatermark(sourcePath: string): Promise<CustomWatermarkAsset> {
  const extension = path.extname(sourcePath).toLowerCase()
  const format = FORMAT_BY_EXTENSION[extension]
  if (!format) throw new Error('请选择 PNG、JPEG 或 WebP 图片')

  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error('无法读取这张水印图片')
  if (sourceStat.size > MAX_FILE_BYTES) throw new Error('水印图片不能超过 20 MB')

  const image = nativeImage.createFromPath(sourcePath)
  const size = image.getSize()
  if (image.isEmpty() || size.width < MIN_IMAGE_SIDE || size.height < MIN_IMAGE_SIDE) {
    throw new Error('水印图片尺寸不能小于 32 x 32')
  }
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
    throw new Error('水印图片单边不能超过 8192 像素')
  }

  const sha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex')
  const destinationDir = assetDirectory()
  const destination = path.join(destinationDir, `${sha256}${extension === '.jpeg' ? '.jpg' : extension}`)
  await mkdir(destinationDir, { recursive: true })

  if (!await exists(destination)) {
    const staging = path.join(destinationDir, `.${sha256}.${randomUUID()}.staging`)
    try {
      await copyFile(sourcePath, staging)
      await rename(staging, destination)
    } catch (error) {
      await rm(staging, { force: true })
      if (!await exists(destination)) throw error
    }
  }

  return {
    id: `watermark_${sha256.slice(0, 20)}`,
    fileName: path.basename(sourcePath),
    filePath: destination,
    format,
    width: size.width,
    height: size.height,
    bytes: sourceStat.size,
    sha256,
  }
}

export async function chooseCustomWatermark(): Promise<CustomWatermarkAsset | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择自定义水印',
    filters: [{ name: '水印图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const asset = await importCustomWatermark(result.filePaths[0])
  const settings = await getSettings()
  await saveSettings({
    customWatermarkAssets: addCustomWatermarkAsset(settings.customWatermarkAssets ?? [], asset),
  })
  return asset
}
