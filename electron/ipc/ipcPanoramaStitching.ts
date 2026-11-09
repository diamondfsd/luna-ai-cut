import { app, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type { IpcContext } from './context'
import { stitchPanoramaAsync } from '../platform/render/lunaRenderCore'
import { logMainError } from '../infrastructure/loggerService'
import { captureDateFromMediaSource } from '../media/mediaCaptureDate'
import { lunaKaHttpClient } from '../network/lunaka_http_client'
import { downloadToFileWithRetry } from '../media/fileDownloadService'
import type { PanoramaDownloadProgress } from '../../src/shared/types'

const allowedWidths = new Set([16_000, 24_000, 32_000])
const panoramaModes = new Set([
  'grid_666',
  'rings_675',
  'rings_585',
  'rings_675_plus3',
  'rings_788_plus_zenith',
  'rings_887_plus_zenith',
  'sphere_7x3_manual3_zenith',
  'sphere_887_manual3_zenith_v2',
  'sphere_visual_8888_manual3_top_v1',
  'sphere_9x10x9_manual3_zenith_v1',
  'sphere_10x11x10_manual3_zenith_v1',
])
type PanoramaPose = { slot: number; yaw: number; pitch: number; roll: number; manual?: boolean }
type PhonePanoramaRecord = {
  id: string
  mode?: unknown
  poses?: unknown
  photos: Array<{ slot: number; available: boolean }>
}
type LocalPanoramaManifest = {
  id: string
  mode: string | null
  poses: PanoramaPose[] | null
  photoCount?: number
  slots?: number[]
}
type LocalPanoramaRecord = {
  state: 'downloaded' | 'partial' | 'not-downloaded'
  downloadedPhotos: number
  paths: string[]
  mode: string | null
  poses: PanoramaPose[] | null
}

const activePanoramaDownloads = new Map<string, { senderId: number; controller: AbortController }>()

function readRecordPoses(record: PhonePanoramaRecord, count: number): { mode: string | null; poses: PanoramaPose[] | null } {
  if (record.mode == null && record.poses == null) return { mode: null, poses: null }
  const expectedCountByMode: Record<string, number> = {
    sphere_7x3_manual3_zenith: 25,
    grid_666: 19,
    rings_675: 19,
    rings_585: 19,
    rings_675_plus3: 22,
    rings_788_plus_zenith: 24,
    rings_887_plus_zenith: 24,
    sphere_887_manual3_zenith_v2: 27,
    sphere_visual_8888_manual3_top_v1: 36,
    sphere_9x10x9_manual3_zenith_v1: 32,
    sphere_10x11x10_manual3_zenith_v1: 35,
  }
  if (typeof record.mode !== 'string' || !panoramaModes.has(record.mode) || count !== expectedCountByMode[record.mode] || !Array.isArray(record.poses) || record.poses.length !== count) {
    throw new Error('拍摄记录的机位信息不完整')
  }
  const poses = record.poses.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('拍摄记录的机位信息无效')
    const pose = value as Record<string, unknown>
    if (!Number.isInteger(pose.slot) || typeof pose.yaw !== 'number' || !Number.isFinite(pose.yaw) || typeof pose.pitch !== 'number' || !Number.isFinite(pose.pitch) || typeof pose.roll !== 'number' || !Number.isFinite(pose.roll)) {
      throw new Error('拍摄记录的机位信息无效')
    }
    if (pose.manual != null && typeof pose.manual !== 'boolean') throw new Error('拍摄记录的机位信息无效')
    return { slot: pose.slot as number, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll, ...(pose.manual === true ? { manual: true } : {}) }
  }).sort((a, b) => a.slot - b.slot)
  if (poses.some((pose, index) => pose.slot !== index)) throw new Error('拍摄记录的机位信息不完整')
  return { mode: record.mode, poses }
}

function validatePhotoCount(value: unknown): 19 | 22 | 24 | 25 | 27 | 32 | 35 | 36 {
  if (value === 19 || value === 22 || value === 24 || value === 25 || value === 27 || value === 32 || value === 35 || value === 36) return value
  throw new Error('拍摄布局无效')
}

function recordDirectory(recordId: string): string {
  return join(app.getPath('userData'), 'panorama-records', recordId)
}

async function isValidJpeg(filePath: string): Promise<boolean> {
  let file
  try {
    file = await open(filePath, 'r')
    const info = await file.stat()
    if (info.size < 4) return false
    const start = Buffer.alloc(2)
    const end = Buffer.alloc(2)
    const first = await file.read(start, 0, 2, 0)
    const last = await file.read(end, 0, 2, info.size - 2)
    return first.bytesRead === 2 && last.bytesRead === 2
      && start[0] === 0xff && start[1] === 0xd8
      && end[0] === 0xff && end[1] === 0xd9
  } catch {
    return false
  } finally {
    await file?.close().catch(() => undefined)
  }
}

async function readLocalPanoramaManifest(recordId: string): Promise<LocalPanoramaManifest | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(recordDirectory(recordId), 'record.json'), 'utf8'))
    if (!value || typeof value !== 'object') return null
    const manifest = value as Record<string, unknown>
    if (manifest.id !== recordId) return null
    if (manifest.photoCount != null && !Number.isInteger(manifest.photoCount)) return null
    if (manifest.slots != null && (!Array.isArray(manifest.slots)
      || !manifest.slots.every((slot) => Number.isInteger(slot)))) return null
    if (manifest.mode != null && typeof manifest.mode !== 'string') return null
    if (manifest.poses != null && !Array.isArray(manifest.poses)) return null
    const mode = typeof manifest.mode === 'string' ? manifest.mode : null
    const poses = Array.isArray(manifest.poses)
      ? manifest.poses as PanoramaPose[]
      : null
    const parsed: LocalPanoramaManifest = {
      id: recordId,
      mode,
      poses,
      ...(Number.isInteger(manifest.photoCount) ? { photoCount: manifest.photoCount as number } : {}),
      ...(Array.isArray(manifest.slots) && manifest.slots.every((slot) => Number.isInteger(slot))
        ? { slots: manifest.slots as number[] }
        : {}),
    }
    return parsed
  } catch {
    return null
  }
}

async function inspectLocalPanoramaRecord(recordId: string, photoCount: number): Promise<LocalPanoramaRecord> {
  const directory = recordDirectory(recordId)
  const paths = Array.from({ length: photoCount }, (_, slot) =>
    join(directory, `photo-${String(slot).padStart(2, '0')}.jpg`),
  )
  const validPhotos = await Promise.all(paths.map(isValidJpeg))
  const downloadedPhotos = validPhotos.filter(Boolean).length
  const manifest = await readLocalPanoramaManifest(recordId)
  const slotsMatch = manifest?.slots == null
    || (manifest.slots.length === photoCount && manifest.slots.every((slot, index) => slot === index))
  const countMatches = manifest?.photoCount == null || manifest.photoCount === photoCount
  const metadataMatches = manifest != null && manifest.id === recordId && slotsMatch && countMatches
  let posesMatch = false
  if (metadataMatches && manifest) {
    try {
      readRecordPoses({ id: recordId, mode: manifest.mode, poses: manifest.poses, photos: [] }, photoCount)
      posesMatch = true
    } catch {
      posesMatch = false
    }
  }
  const complete = downloadedPhotos === photoCount && metadataMatches && posesMatch
  return {
    state: complete ? 'downloaded' : downloadedPhotos > 0 ? 'partial' : 'not-downloaded',
    downloadedPhotos,
    paths,
    mode: manifest?.mode ?? null,
    poses: manifest?.poses ?? null,
  }
}

export function register(ctx: IpcContext): void {
  ipcMain.handle('panorama:list-local-download-statuses', async (_event, records: unknown) => {
    if (!Array.isArray(records) || records.length > 200) throw new Error('拍摄记录无效')
    return await Promise.all(records.map(async (value) => {
      if (!value || typeof value !== 'object') throw new Error('拍摄记录无效')
      const item = value as Record<string, unknown>
      if (typeof item.recordId !== 'string' || !/^panorama-\d+$/.test(item.recordId)) {
        throw new Error('拍摄记录无效')
      }
      const photoCount = validatePhotoCount(item.photoCount)
      const local = await inspectLocalPanoramaRecord(item.recordId, photoCount)
      return {
        recordId: item.recordId,
        totalPhotos: photoCount,
        downloadedPhotos: local.downloadedPhotos,
        state: local.state,
      }
    }))
  })

  ipcMain.handle('panorama:load-local-record', async (_event, recordId: unknown, count: unknown) => {
    if (typeof recordId !== 'string' || !/^panorama-\d+$/.test(recordId)) throw new Error('拍摄记录无效')
    const photoCount = validatePhotoCount(count)
    const local = await inspectLocalPanoramaRecord(recordId, photoCount)
    if (local.state !== 'downloaded') throw new Error('本地拍摄记录不完整，请重新下载')
    return { paths: local.paths, mode: local.mode, poses: local.poses }
  })

  ipcMain.handle('panorama:download-phone-record', async (event, endpoint: unknown, recordId: unknown) => {
    if (typeof endpoint !== 'string' || typeof recordId !== 'string' || !/^panorama-\d+$/.test(recordId)) throw new Error('拍摄记录无效')
    const payload = await lunaKaHttpClient.request<{ service: string; records: PhonePanoramaRecord[] }>(endpoint, '/api/v1/panorama/records')
    const record = payload.service === 'luna-ka-panorama' && Array.isArray(payload.records)
      ? payload.records.find((item) => item.id === recordId) : null
    if (!record || !Array.isArray(record.photos)) throw new Error('拍摄记录不存在')
    const slots = record.photos.map((photo) => photo.slot).sort((a, b) => a - b)
    const photoCount = validatePhotoCount(slots.length)
    if (slots.some((slot, index) => slot !== index) || record.photos.some((photo) => !photo.available)) {
      throw new Error('拍摄记录不完整或手机原片不可用')
    }
    const { mode, poses } = readRecordPoses(record, photoCount)
    if (photoCount === 22 && (!mode || !poses)) throw new Error('22 张拍摄记录缺少机位信息')
    const local = await inspectLocalPanoramaRecord(recordId, photoCount)
    if (local.state === 'downloaded') return { paths: local.paths, mode, poses }

    const directory = recordDirectory(recordId)
    await mkdir(directory, { recursive: true })
    if (activePanoramaDownloads.has(recordId)) throw new Error('该拍摄记录正在下载')
    const controller = new AbortController()
    activePanoramaDownloads.set(recordId, { senderId: event.sender.id, controller })
    const sendProgress = (progress: Omit<PanoramaDownloadProgress, 'recordId' | 'totalPhotos'>): void => {
      if (event.sender.isDestroyed()) return
      event.sender.send('panorama:phone-record-download-progress', {
        ...progress,
        recordId,
        totalPhotos: photoCount,
      } satisfies PanoramaDownloadProgress)
    }
    sendProgress({ slot: 0, completedPhotos: 0, downloaded: 0, total: null, percent: null, status: 'downloading' })
    const paths: string[] = []
    let completedPhotos = 0
    try {
      // The manifest represents a complete record only. Remove any stale
      // completion marker before repairing an incomplete set.
      const manifestPath = join(directory, 'record.json')
      await rm(manifestPath, { force: true })
      for (const [index, slot] of slots.entries()) {
        if (controller.signal.aborted) throw new Error('下载已取消')
        const url = new URL(`/api/v1/panorama/records/${recordId}/photos/${slot}`, endpoint).toString()
        const destination = join(directory, `photo-${String(slot).padStart(2, '0')}.jpg`)
        if (await isValidJpeg(destination)) {
          paths.push(destination)
          completedPhotos += 1
          sendProgress({
            slot,
            completedPhotos,
            downloaded: 0,
            total: null,
            percent: null,
            status: 'photo-complete',
          })
          continue
        }
        await rm(destination, { force: true })
        let lastProgress: { downloaded: number; total: number | null; percent: number | null } = {
          downloaded: 0,
          total: null,
          percent: null,
        }
        try {
          const headers = await lunaKaHttpClient.authorizationHeadersFor(url)
          await downloadToFileWithRetry(
            { name: `photo-${slot}.jpg`, bytes: 0, sourceUrl: url, headers },
            destination,
            (progress) => {
              const hasTotal = progress.total !== null && progress.total > 0
              lastProgress = { ...progress, total: hasTotal ? progress.total : null, percent: hasTotal ? progress.percent : null }
              sendProgress({
                slot,
                completedPhotos,
                ...lastProgress,
                status: 'downloading',
              })
            },
            controller.signal,
          )
          if (!await isValidJpeg(destination)) throw new Error('下载文件不是有效的 JPEG 照片')
          paths.push(destination)
          completedPhotos += 1
          sendProgress({
            slot,
            completedPhotos,
            ...lastProgress,
            status: 'photo-complete',
          })
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            sendProgress({ slot, completedPhotos, ...lastProgress, status: 'cancelled' })
            throw new Error('下载已取消')
          }
          const reason = error instanceof Error ? error.message : String(error)
          sendProgress({ slot, completedPhotos, ...lastProgress, status: 'failed', error: reason })
          throw new Error(`第 ${index + 1} 张下载失败：${reason}`)
        }
      }
      if (controller.signal.aborted) throw new Error('下载已取消')
      const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
      try {
        await writeFile(temporaryPath, JSON.stringify({
          version: 1,
          id: recordId,
          photoCount,
          slots,
          mode,
          poses,
          downloadedAt: new Date().toISOString(),
        }), 'utf8')
        await rename(temporaryPath, manifestPath)
      } catch (error) {
        await rm(temporaryPath, { force: true })
        throw error
      }
      if (controller.signal.aborted) {
        await rm(manifestPath, { force: true })
        throw new Error('下载已取消')
      }
      sendProgress({
        slot: slots[slots.length - 1],
        completedPhotos,
        downloaded: 0,
        total: null,
        percent: 100,
        status: 'complete',
      })
    } finally {
      activePanoramaDownloads.delete(recordId)
    }
    return { paths, mode, poses }
  })
  ipcMain.handle('panorama:cancel-phone-record-download', async (event, recordId: unknown) => {
    if (typeof recordId !== 'string' || !/^panorama-\d+$/.test(recordId)) throw new Error('拍摄记录无效')
    const active = activePanoramaDownloads.get(recordId)
    if (active?.senderId === event.sender.id) active.controller.abort()
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
    const isTwentyTwoPhotoLayout = input.rows === 3 && input.columns === 7
    const isTwentyFourRingLayout = input.rows === 3 && input.columns === 8
    const isTwentyFivePhotoLayout = input.rows === 3 && input.columns === 9
    const isRectangularLayout = input.rows === 4 &&
      (input.columns === 6 || input.columns === 8)
    const isVisual36Layout = input.rows === 4 && input.columns === 8 &&
      Array.isArray(input.paths) && input.paths.length === 36
    if (!isNineteenPhotoLayout && !isTwentyTwoPhotoLayout && !isTwentyFourRingLayout && !isTwentyFivePhotoLayout && !isRectangularLayout) {
      throw new Error('拍摄布局无效')
    }
    const rows = input.rows as 3 | 4
    const columns = input.columns as 6 | 7 | 8 | 9
    const variableEightColumnRingCount = Array.isArray(input.paths) ? input.paths.length : 0
    if (isTwentyFourRingLayout && ![24, 27, 32, 35].includes(variableEightColumnRingCount)) {
      throw new Error('8 列环拍布局支持 24、27、32 或 35 张照片')
    }
    const expectedPhotos = isNineteenPhotoLayout
      ? 19
      : isTwentyTwoPhotoLayout
        ? 22
        : isTwentyFivePhotoLayout
          ? 25
          : isTwentyFourRingLayout
            ? variableEightColumnRingCount
            : isVisual36Layout ? 36 : rows * columns
    if (!Array.isArray(input.paths) || input.paths.length !== expectedPhotos
      || input.paths.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error(`请选择 ${expectedPhotos} 张照片`)
    }
    if (!isVisual36Layout && (!Array.isArray(input.poses) || input.poses.length !== expectedPhotos
      || input.poses.some((pose) => !Array.isArray(pose) || pose.length !== 3
        || pose.some((angle) => typeof angle !== 'number' || !Number.isFinite(angle))))) {
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
      const poses = isVisual36Layout
        ? Array.from({ length: expectedPhotos }, () => [0, 0, 0])
        : input.poses as number[][]
      return await stitchPanoramaAsync(
        paths,
        poses,
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
