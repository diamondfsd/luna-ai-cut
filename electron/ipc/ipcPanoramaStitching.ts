import { app, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { access, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type { IpcContext } from './context'
import { stitchPanoramaAsync } from '../platform/render/lunaRenderCore'
import { logMainError } from '../infrastructure/loggerService'
import { captureDateFromMediaSource } from '../media/mediaCaptureDate'
import { lunaKaHttpClient } from '../network/lunaka_http_client'
import { downloadToFileWithRetry } from '../media/fileDownloadService'

const allowedWidths = new Set([16_000, 24_000, 32_000])
const panoramaModes = new Set(['grid_666', 'rings_675', 'rings_585'])
type PanoramaPose = { slot: number; yaw: number; pitch: number; roll: number }
type PhonePanoramaRecord = {
  id: string
  mode?: unknown
  poses?: unknown
  photos: Array<{ slot: number; available: boolean }>
}

function readRecordPoses(record: PhonePanoramaRecord, count: number): { mode: string | null; poses: PanoramaPose[] | null } {
  if (record.mode == null && record.poses == null) return { mode: null, poses: null }
  if (count !== 19 || typeof record.mode !== 'string' || !panoramaModes.has(record.mode) || !Array.isArray(record.poses) || record.poses.length !== count) {
    throw new Error('拍摄记录的机位信息不完整')
  }
  const poses = record.poses.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('拍摄记录的机位信息无效')
    const pose = value as Record<string, unknown>
    if (!Number.isInteger(pose.slot) || typeof pose.yaw !== 'number' || !Number.isFinite(pose.yaw) || typeof pose.pitch !== 'number' || !Number.isFinite(pose.pitch) || typeof pose.roll !== 'number' || !Number.isFinite(pose.roll)) {
      throw new Error('拍摄记录的机位信息无效')
    }
    return { slot: pose.slot as number, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll }
  }).sort((a, b) => a.slot - b.slot)
  if (poses.some((pose, index) => pose.slot !== index)) throw new Error('拍摄记录的机位信息不完整')
  return { mode: record.mode, poses }
}

function validatePhotoCount(value: unknown): 19 | 24 | 32 {
  if (value === 19 || value === 24 || value === 32) return value
  throw new Error('拍摄布局无效')
}

export function register(ctx: IpcContext): void {
  ipcMain.handle('panorama:download-phone-record', async (_event, endpoint: unknown, recordId: unknown) => {
    if (typeof endpoint !== 'string' || typeof recordId !== 'string' || !/^panorama-\d+$/.test(recordId)) throw new Error('拍摄记录无效')
    const payload = await lunaKaHttpClient.request<{ service: string; records: PhonePanoramaRecord[] }>(endpoint, '/api/v1/panorama/records')
    const record = payload.service === 'luna-ka-panorama' && Array.isArray(payload.records)
      ? payload.records.find((item) => item.id === recordId) : null
    if (!record || !Array.isArray(record.photos)) throw new Error('拍摄记录不存在')
    const slots = record.photos.map((photo) => photo.slot).sort((a, b) => a - b)
    if (![19, 24, 32].includes(slots.length) || slots.some((slot, index) => slot !== index) || record.photos.some((photo) => !photo.available)) {
      throw new Error('拍摄记录不完整或手机原片不可用')
    }
    const { mode, poses } = readRecordPoses(record, slots.length)
    const directory = join(app.getPath('userData'), 'panorama-records', recordId)
    await mkdir(directory, { recursive: true })
    const paths: string[] = []
    for (const slot of slots) {
      const url = new URL(`/api/v1/panorama/records/${recordId}/photos/${slot}`, endpoint).toString()
      const destination = join(directory, `photo-${String(slot).padStart(2, '0')}.jpg`)
      const headers = await lunaKaHttpClient.authorizationHeadersFor(url)
      await downloadToFileWithRetry({ name: `photo-${slot}.jpg`, bytes: 0, sourceUrl: url, headers }, destination)
      paths.push(destination)
    }
    const manifestPath = join(directory, 'record.json')
    const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ id: recordId, mode, poses }), 'utf8')
    await rename(temporaryPath, manifestPath)
    return { paths, mode, poses }
  })
  ipcMain.handle('panorama:choose-local-photos', async (_event, photoCount: unknown) => {
    const expectedPhotos = validatePhotoCount(photoCount)
    const parent = ctx.win && !ctx.win.isDestroyed() ? ctx.win : undefined
    const options: OpenDialogOptions = {
      title: `选择 ${expectedPhotos} 张全景照片`,
      buttonLabel: '使用照片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JPEG 图像', extensions: ['jpg', 'jpeg', 'insp'] }],
    }
    const selection = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled) return null
    if (selection.filePaths.length !== expectedPhotos) {
      throw new Error(`请选择正好 ${expectedPhotos} 张 JPEG 照片`)
    }

    const photos: Array<{ path: string; name: string; capturedAt: string | null }> = []
    for (const path of selection.filePaths) {
      photos.push({
        path,
        name: basename(path),
        capturedAt: (await captureDateFromMediaSource(path, 'image'))?.toISOString() ?? null,
      })
    }
    const allHaveTimes = photos.every((photo) => photo.capturedAt !== null)
    photos.sort((left, right) => {
      if (allHaveTimes) {
        const byTime = Date.parse(left.capturedAt!) - Date.parse(right.capturedAt!)
        if (byTime) return byTime
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    return photos
  })

  ipcMain.handle('panorama:stitch', async (_event, request: unknown) => {
    if (!request || typeof request !== 'object') throw new Error('全景参数无效')
    const input = request as { paths?: unknown; poses?: unknown; rows?: unknown; columns?: unknown; targetWidth?: unknown }
    const isNineteenPhotoLayout = input.rows === 3 && input.columns === 6
    const isRectangularLayout = input.rows === 4 &&
      (input.columns === 6 || input.columns === 8)
    if (!isNineteenPhotoLayout && !isRectangularLayout) {
      throw new Error('拍摄布局无效')
    }
    const rows = input.rows as 3 | 4
    const columns = input.columns as 6 | 8
    const expectedPhotos = isNineteenPhotoLayout ? 19 : rows * columns
    if (!Array.isArray(input.paths) || input.paths.length !== expectedPhotos
      || input.paths.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error(`请选择 ${expectedPhotos} 张照片`)
    }
    if (!Array.isArray(input.poses) || input.poses.length !== expectedPhotos
      || input.poses.some((pose) => !Array.isArray(pose) || pose.length !== 3
        || pose.some((angle) => typeof angle !== 'number' || !Number.isFinite(angle)))) {
      throw new Error('拍摄位置无效')
    }
    if (typeof input.targetWidth !== 'number' || !allowedWidths.has(input.targetWidth)) {
      throw new Error('输出尺寸无效')
    }

    const paths = input.paths as string[]
    for (const path of paths) {
      if (!/\.(?:jpe?g|insp)$/i.test(path)) throw new Error('仅支持 JPEG 照片')
      await access(path)
      const info = await stat(path)
      if (!info.isFile()) throw new Error(`照片文件无效：${basename(path)}`)
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const parent = ctx.win && !ctx.win.isDestroyed() ? ctx.win : undefined
    const saveResult = parent
      ? await dialog.showSaveDialog(parent, {
          title: '保存 360 全景照片',
          defaultPath: join(app.getPath('pictures'), `Luna-360-${timestamp}.jpg`),
          buttonLabel: '保存并合成',
          filters: [{ name: 'JPEG 图像', extensions: ['jpg', 'jpeg'] }],
        })
      : await dialog.showSaveDialog({
          title: '保存 360 全景照片',
          defaultPath: join(app.getPath('pictures'), `Luna-360-${timestamp}.jpg`),
          buttonLabel: '保存并合成',
          filters: [{ name: 'JPEG 图像', extensions: ['jpg', 'jpeg'] }],
        })
    if (saveResult.canceled || !saveResult.filePath) return null

    let outputPath = saveResult.filePath
    if (!extname(outputPath)) outputPath += '.jpg'
    if (!/\.jpe?g$/i.test(outputPath)) throw new Error('请选择 JPEG 文件')

    try {
      return await stitchPanoramaAsync(
        paths,
        input.poses as number[][],
        rows,
        columns,
        input.targetWidth,
        outputPath,
      )
    } catch (error) {
      logMainError('[全景合成] 失败', {
        inputCount: paths.length,
        rows,
        columns,
        targetWidth: input.targetWidth,
        outputPath,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })
}
