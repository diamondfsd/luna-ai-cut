import { app, dialog, nativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import type { CustomWatermarkAsset } from '../../../src/shared/types'
import { addCustomWatermarkAssets, removeCustomWatermarkAsset } from '../../../src/shared/watermarkLibrary'
import { convertWebpWatermarkToPng, probeWatermarkImage } from './customWatermarkImage'
import { getFfmpegPath, getFfprobePath } from '../../platform/ffmpeg/pipeline'
import { getSettings, saveSettings } from '../../storage/settingsService'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_SIDE = 2048
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

  let size: { width: number; height: number }
  try {
    size = format === 'webp'
      ? await probeWatermarkImage(sourcePath, getFfprobePath())
      : nativeImage.createFromPath(sourcePath).getSize()
  } catch {
    throw new Error('无法读取这张水印图片')
  }
  if (size.width <= 0 || size.height <= 0) throw new Error('无法读取这张水印图片')
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
    throw new Error('水印图片单边不能超过 2048 像素')
  }

  const destinationDir = assetDirectory()
  await mkdir(destinationDir, { recursive: true })
  const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex')
  const staging = path.join(destinationDir, `.${sourceSha256}.${randomUUID()}.staging${format === 'webp' ? '.png' : ''}`)

  let importedPath = sourcePath
  try {
    if (format === 'webp') {
      await convertWebpWatermarkToPng(sourcePath, staging, getFfmpegPath())
      const converted = nativeImage.createFromPath(staging)
      if (converted.isEmpty() || converted.getSize().width !== size.width || converted.getSize().height !== size.height) {
        throw new Error('转换后的图片无效')
      }
      importedPath = staging
    }

    const importedBytes = await readFile(importedPath)
    const sha256 = createHash('sha256').update(importedBytes).digest('hex')
    const outputFormat: CustomWatermarkAsset['format'] = format === 'webp' ? 'png' : format
    const outputExtension = outputFormat === 'jpeg' ? '.jpg' : `.${outputFormat}`
    const destination = path.join(destinationDir, `${sha256}${outputExtension}`)

    if (!await exists(destination)) {
      try {
        if (format !== 'webp') await copyFile(sourcePath, staging)
        await rename(staging, destination)
      } catch (error) {
        if (!await exists(destination)) throw error
      }
    }
    const destinationStat = await stat(destination)

    return {
      id: `watermark_${sha256.slice(0, 20)}`,
      fileName: path.basename(sourcePath),
      filePath: destination,
      format: outputFormat,
      width: size.width,
      height: size.height,
      bytes: destinationStat.size,
      sha256,
    }
  } catch {
    throw new Error('无法读取这张水印图片')
  } finally {
    await rm(staging, { force: true })
  }
}

export async function chooseCustomWatermarks(): Promise<CustomWatermarkAsset[]> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: '选择自定义水印图片',
    filters: [{ name: '水印图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return []
  const assets = await Promise.all(result.filePaths.map(importCustomWatermark))
  const settings = await getSettings()
  await saveSettings({
    customWatermarkAssets: addCustomWatermarkAssets(settings.customWatermarkAssets ?? [], assets),
  })
  return assets
}

export async function listCustomWatermarks(): Promise<CustomWatermarkAsset[]> {
  return (await getSettings()).customWatermarkAssets ?? []
}

export async function deleteCustomWatermark(assetId: string): Promise<CustomWatermarkAsset[]> {
  const settings = await getSettings()
  const customWatermarkAssets = removeCustomWatermarkAsset(settings.customWatermarkAssets ?? [], assetId)
  const patch: Parameters<typeof saveSettings>[0] = { customWatermarkAssets }
  if (settings.recentWatermarkSettings?.customAsset?.id === assetId) {
    patch.recentWatermarkSettings = {
      ...settings.recentWatermarkSettings,
      sourceKind: 'builtin',
      position: settings.recentWatermarkSettings.position === 'top-center'
        ? 'bottom-center'
        : settings.recentWatermarkSettings.position,
      customAsset: undefined,
      imagePath: undefined,
      imageWidth: undefined,
      imageHeight: undefined,
      sizeOnCanvasWidth: undefined,
      placement: undefined,
      opacity: undefined,
    }
  }
  await saveSettings(patch)
  return customWatermarkAssets
}
