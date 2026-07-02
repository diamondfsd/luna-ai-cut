import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { DownloadRecord, LunaFile } from '../src/shared/types'

const MANIFEST_FILE = '.luna-media-manifest.json'

interface SourceRecord {
  fileName: string
  originalName: string
  sourceDeviceId?: string
  sourceDeviceName?: string
  cameraType?: string
  cameraSerial?: string
  watermarkProfileId?: string
  storageId?: string
  storageLabel?: string
  sourceUrl?: string
  capturedAt?: string | null
  downloadedAt: string
}

interface SourceManifest {
  version: 1
  files: Record<string, SourceRecord>
}

function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILE)
}

async function readManifest(dir: string): Promise<SourceManifest> {
  try {
    const raw = await fs.readFile(manifestPath(dir), 'utf8')
    const parsed = JSON.parse(raw) as SourceManifest
    if (parsed?.version === 1 && parsed.files && typeof parsed.files === 'object') return parsed
  } catch {
    // Missing or invalid manifest is treated as empty.
  }
  return { version: 1, files: {} }
}

async function writeManifest(dir: string, manifest: SourceManifest): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const target = manifestPath(dir)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, target)
}

function normalizeRecord(fileName: string, file: LunaFile): SourceRecord {
  return {
    fileName,
    originalName: file.name,
    sourceDeviceId: file.sourceDeviceId,
    sourceDeviceName: file.sourceDeviceName,
    cameraType: file.cameraType,
    cameraSerial: file.cameraSerial,
    watermarkProfileId: file.watermarkProfileId ?? file.sourceDeviceId,
    storageId: file.storageId,
    storageLabel: file.storageLabel,
    sourceUrl: file.sourceUrl || file.url,
    capturedAt: file.capturedAt,
    downloadedAt: new Date().toISOString(),
  }
}

export async function recordDownloadedFileSource(outputDir: string, destination: string, file: LunaFile): Promise<void> {
  const fileName = path.basename(destination)
  const manifest = await readManifest(outputDir)
  manifest.files[fileName] = normalizeRecord(fileName, file)
  await writeManifest(outputDir, manifest)
}

export async function applySourceMetadataToFile(outputDir: string, file: LunaFile): Promise<LunaFile> {
  const manifest = await readManifest(outputDir)
  const record = manifest.files[path.basename(file.downloadFilePath ?? file.localPath ?? file.downloadName)]
  if (!record) return file
  return {
    ...file,
    sourceDeviceId: file.sourceDeviceId ?? record.sourceDeviceId,
    sourceDeviceName: file.sourceDeviceName ?? record.sourceDeviceName,
    cameraType: file.cameraType ?? record.cameraType,
    cameraSerial: file.cameraSerial ?? record.cameraSerial,
    watermarkProfileId: file.watermarkProfileId ?? record.watermarkProfileId,
    storageId: file.storageId ?? record.storageId,
    storageLabel: file.storageLabel ?? record.storageLabel,
  }
}

export async function readSourceRecord(outputDir: string, fileName: string): Promise<SourceRecord | null> {
  const manifest = await readManifest(outputDir)
  return manifest.files[fileName] ?? null
}

export function withSourceMetadata<T extends LunaFile | DownloadRecord>(item: T, record: SourceRecord | null): T {
  if (!record) return item
  return {
    ...item,
    sourceDeviceId: item.sourceDeviceId ?? record.sourceDeviceId,
    sourceDeviceName: item.sourceDeviceName ?? record.sourceDeviceName,
    cameraType: item.cameraType ?? record.cameraType,
    cameraSerial: item.cameraSerial ?? record.cameraSerial,
    watermarkProfileId: item.watermarkProfileId ?? record.watermarkProfileId,
  }
}
