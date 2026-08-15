import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { lunaMediaAdapter } from './deviceMedia.ts'
import { safeName } from './filePathUtils.ts'
import { readSourceRecord, moveSourceRecord } from './mediaSourceManifestService.ts'
import { prepareDownloadDirectory } from './downloadDirectoryService.ts'
import type { LunaFile } from '../src/shared/types'

const DATE_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface DownloadOrganizationResult {
  moved: number
  skipped: number
  failed: number
}

function isValidDateFolder(value: string | null | undefined): value is string {
  return Boolean(value && DATE_FOLDER_PATTERN.test(value))
}

function dateFolderFromDate(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFolderFromCapturedAt(capturedAt: string | null | undefined): string | null {
  if (!capturedAt) return null
  const date = new Date(capturedAt)
  return dateFolderFromDate(date)
}

export function downloadDateFolder(file: Pick<LunaFile, 'capturedAt' | 'groupDay'>): string | null {
  if (isValidDateFolder(file.groupDay)) return file.groupDay
  return dateFolderFromCapturedAt(file.capturedAt)
}

export function downloadDestinationFor(
  outputDir: string,
  file: Pick<LunaFile, 'downloadName' | 'capturedAt' | 'groupDay'>,
  organizeByDate: boolean,
): string {
  const filePath = safeName(file.downloadName)
  const dateFolder = organizeByDate ? downloadDateFolder(file) : null
  return dateFolder ? path.join(outputDir, dateFolder, filePath) : path.join(outputDir, filePath)
}

export function downloadPathCandidates(
  outputDir: string,
  file: Pick<LunaFile, 'downloadName' | 'capturedAt' | 'groupDay'>,
  preferDate: boolean,
): string[] {
  const rootPath = downloadDestinationFor(outputDir, file, false)
  const datePath = downloadDestinationFor(outputDir, file, true)
  return [...new Set(preferDate ? [datePath, rootPath] : [rootPath, datePath])]
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath)
    return true
  } catch {
    return false
  }
}

export async function findDownloadedPath(
  outputDir: string,
  file: LunaFile,
  preferDate = false,
): Promise<string | null> {
  for (const candidate of downloadPathCandidates(outputDir, file, preferDate)) {
    if (!await isNonEmptyFile(candidate)) continue
    if (file.rawCompanion) {
      const rawPath = path.join(path.dirname(candidate), safeName(file.rawCompanion.downloadName))
      if (!await isNonEmptyFile(rawPath)) continue
    }
    return candidate
  }
  return null
}

function capturedAtForFile(fileName: string, capturedAt: string | null | undefined): Date | null {
  return dateFolderFromCapturedAt(capturedAt)
    ? new Date(capturedAt as string)
    : lunaMediaAdapter.capturedAt(fileName)
}

export async function organizeDownloadedFiles(outputDir: string): Promise<DownloadOrganizationResult> {
  const rootDir = await prepareDownloadDirectory(outputDir)
  const result: DownloadOrganizationResult = { moved: 0, skipped: 0, failed: 0 }
  const entries = await fs.readdir(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue
    const kind = lunaMediaAdapter.mediaKind(entry.name)
    if (kind === 'unknown' || kind === 'lrv') continue

    const sourcePath = path.join(rootDir, entry.name)
    const sourceRecord = await readSourceRecord(rootDir, sourcePath)
    const capturedAt = capturedAtForFile(entry.name, sourceRecord?.capturedAt)
    const dateFolder = dateFolderFromDate(capturedAt)
    if (!dateFolder) {
      result.skipped += 1
      continue
    }

    const targetDir = path.join(rootDir, dateFolder)
    const targetPath = path.join(targetDir, safeName(entry.name))
    if (await pathExists(targetPath)) {
      result.skipped += 1
      continue
    }

    try {
      await fs.mkdir(targetDir, { recursive: true })
      await fs.rename(sourcePath, targetPath)
      await moveSourceRecord(rootDir, sourcePath, targetPath)
      result.moved += 1
    } catch {
      result.failed += 1
    }
  }

  return result
}
