import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { DownloadRecord, LunaFile } from '../src/shared/types'

const MANIFEST_FILE = '.luna-media-manifest.json'
const manifestWrites = new Map<string, Promise<void>>()

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

function manifestKey(outputDir: string, filePath: string): string {
  const relative = path.isAbsolute(filePath) ? path.relative(outputDir, filePath) : filePath
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return path.basename(filePath)
  }
  return relative.split(path.sep).join('/')
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
  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    try {
      await fs.rename(temporary, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!['EACCES', 'EEXIST', 'EPERM'].includes(String(code))) throw error
      await fs.rm(target, { force: true })
      await fs.rename(temporary, target)
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function withManifestWrite(dir: string, write: () => Promise<void>): Promise<void> {
  const key = path.resolve(dir)
  const previous = manifestWrites.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(write)
  manifestWrites.set(key, current)
  try {
    await current
  } finally {
    if (manifestWrites.get(key) === current) manifestWrites.delete(key)
  }
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
  await withManifestWrite(outputDir, async () => {
    const fileName = path.basename(destination)
    const manifest = await readManifest(outputDir)
    manifest.files[manifestKey(outputDir, destination)] = normalizeRecord(fileName, file)
    await writeManifest(outputDir, manifest)
  })
}

export async function moveSourceRecord(outputDir: string, sourcePath: string, targetPath: string): Promise<void> {
  await withManifestWrite(outputDir, async () => {
    const sourceKey = manifestKey(outputDir, sourcePath)
    const targetKey = manifestKey(outputDir, targetPath)
    if (sourceKey === targetKey) return
    const manifest = await readManifest(outputDir)
    const record = manifest.files[sourceKey]
    if (!record) return
    delete manifest.files[sourceKey]
    manifest.files[targetKey] = { ...record, fileName: path.basename(targetPath) }
    await writeManifest(outputDir, manifest)
  })
}

export async function applySourceMetadataToFile(outputDir: string, file: LunaFile): Promise<LunaFile> {
  const manifest = await readManifest(outputDir)
  const filePath = file.downloadFilePath ?? file.localPath ?? file.downloadName
  const record = manifest.files[manifestKey(outputDir, filePath)]
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
  return manifest.files[manifestKey(outputDir, fileName)] ?? null
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
