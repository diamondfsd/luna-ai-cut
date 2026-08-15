import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { lunaMediaAdapter } from './deviceMedia'
import { labelsFor, localThumbnailUrl } from './filePathUtils'
import { findDownloadedPath } from './downloadStorageService'
import { readSourceRecord, withSourceMetadata } from './mediaSourceManifestService'
import { logMainWarn } from './loggerService'
import type { DownloadRecord, LunaFile } from '../src/shared/types'

function isGeneratedLivePreviewName(name: string): boolean {
  return name.toLowerCase().endsWith('.live.mp4')
}

export async function getDownloadedRecords(files: LunaFile[], outputDir: string, preferDate = false): Promise<DownloadRecord[]> {
  const records: DownloadRecord[] = []

  for (const file of files) {
    const destination = await findDownloadedPath(outputDir, file, preferDate)
    if (!destination) continue
    try {
      const stats = await fs.stat(destination)
      if (stats.isFile()) {
        const record = await readSourceRecord(outputDir, destination)
        records.push(withSourceMetadata({ fileName: file.name, path: destination, bytes: stats.size, downloadedAt: stats.mtime.toISOString() }, record))
      }
    } catch {
      // Missing files simply mean the media is not downloaded yet.
    }
  }

  return records
}

export async function listDownloadedFiles(outputDir: string): Promise<LunaFile[]> {
  const files: LunaFile[] = []

  async function appendFile(filePath: string): Promise<void> {
    const name = path.basename(filePath)
    const kind = lunaMediaAdapter.mediaKind(name)
    if (kind === 'unknown' || kind === 'lrv' || name.endsWith('.tmp') || isGeneratedLivePreviewName(name)) return

    const stats = await fs.stat(filePath)
    const timestamp = lunaMediaAdapter.capturedAt(name) ?? stats.mtime
    const labels = labelsFor(timestamp)
    const fileUrl = localThumbnailUrl(filePath)

    const sourceRecord = await readSourceRecord(outputDir, filePath)
    files.push(withSourceMetadata({
      id: filePath,
      name,
      href: name,
      sourceUrl: fileUrl,
      url: fileUrl,
      dateText: labels.dateText,
      timeText: labels.timeText,
      sizeText: String(stats.size),
      bytes: stats.size,
      kind,
      extension: lunaMediaAdapter.extensionOf(name),
      capturedAt: labels.capturedAt,
      groupDay: labels.groupDay,
      groupHour: labels.groupHour,
      videoKey: lunaMediaAdapter.videoKey(name),
      previewName: null,
      previewUrl: null,
      cacheFilePath: null,
      downloadFilePath: filePath,
      thumbnailUrl: null,
      isLivePhoto: Boolean(lunaMediaAdapter.livePhotoKey(name)),
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: name,
      rawCompanion: null,
      canPreview: kind === 'image' || kind === 'video',
      localPath: filePath,
    }, sourceRecord))
  }

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(entryPath)
      else if (entry.isFile()) await appendFile(entryPath)
    }
  }

  try {
    await walk(outputDir)
  } catch (err) {
    logMainWarn(`[listDownloadedFiles] 读取失败`, { outputDir, error: err instanceof Error ? err.message : String(err) })
    return []
  }

  return lunaMediaAdapter.attachRelatedFiles(files)
}
