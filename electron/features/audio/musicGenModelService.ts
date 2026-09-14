import { app } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  MUSICGEN_MODEL_FILES,
  MUSICGEN_MODEL_FILE_DEFINITIONS,
  MUSICGEN_MODEL_ID,
  MUSICGEN_MODEL_INFO,
  isMusicGenModelManifest,
  type MusicGenModelFileName,
  type MusicGenModelManifest,
} from '../../../src/shared/musicGenModels'
import { loadVerifiedModelFile } from '../../infrastructure/modelFileService'

const MUSICGEN_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024

function modelDir(): string {
  return path.join(app.getPath('userData'), 'models', MUSICGEN_MODEL_ID)
}

async function readManifest(directory: string): Promise<MusicGenModelManifest | null> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
  return isMusicGenModelManifest(value) ? value : null
}

export interface MusicGenModelStatus {
  installed: boolean
  modelId: typeof MUSICGEN_MODEL_ID
  version: string | null
  modelDir: string
  missingFiles: MusicGenModelFileName[]
  invalidFiles: MusicGenModelFileName[]
  license: string
  source: string
}

export interface MusicGenModelLoadProgress {
  completedBytes: number
  totalBytes: number
}

export interface MusicGenModelLoadOptions {
  signal?: AbortSignal
  onProgress?: (progress: MusicGenModelLoadProgress) => void
}

export async function getMusicGenModelStatus(): Promise<MusicGenModelStatus> {
  const directory = modelDir()
  const manifest = await readManifest(directory)
  const missingFiles: MusicGenModelFileName[] = []
  const invalidFiles: MusicGenModelFileName[] = []
  if (!manifest) {
    missingFiles.push(...MUSICGEN_MODEL_FILES)
  } else {
    for (const fileName of MUSICGEN_MODEL_FILES) {
      const definition = MUSICGEN_MODEL_FILE_DEFINITIONS.find((file) => file.fileName === fileName)
      const filePath = path.join(directory, fileName)
      const info = await stat(filePath).catch(() => null)
      if (!definition || !info?.isFile()) {
        missingFiles.push(fileName)
        continue
      }
      if (info.size !== definition.sizeBytes) {
        invalidFiles.push(fileName)
      }
    }
  }
  return {
    installed: missingFiles.length === 0 && invalidFiles.length === 0 && manifest !== null,
    modelId: MUSICGEN_MODEL_ID,
    version: manifest?.version ?? null,
    modelDir: directory,
    missingFiles,
    invalidFiles,
    license: manifest?.license ?? MUSICGEN_MODEL_INFO.license,
    source: manifest?.source ?? MUSICGEN_MODEL_INFO.source,
  }
}

export async function loadMusicGenModelDirectory(options: MusicGenModelLoadOptions = {}): Promise<string> {
  const directory = modelDir()
  await mkdir(directory, { recursive: true })
  const totalBytes = MUSICGEN_MODEL_FILE_DEFINITIONS.reduce((total, file) => total + file.sizeBytes, 0)
  let completedBytes = 0
  for (const definition of MUSICGEN_MODEL_FILE_DEFINITIONS) {
    await loadVerifiedModelFile(directory, definition, {
      label: `MusicGen 模型文件「${definition.fileName}」`,
      maxBytes: MUSICGEN_MAX_FILE_BYTES,
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.({
        completedBytes: completedBytes + progress.completedBytes,
        totalBytes,
      }),
    })
    completedBytes += definition.sizeBytes
  }
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: MUSICGEN_MODEL_ID,
    version: MUSICGEN_MODEL_INFO.version,
    files: MUSICGEN_MODEL_FILE_DEFINITIONS.map(({ fileName, sizeBytes, sha256 }) => ({ fileName, sizeBytes, sha256 })),
    license: MUSICGEN_MODEL_INFO.license,
    licenseUrl: MUSICGEN_MODEL_INFO.licenseUrl,
    source: MUSICGEN_MODEL_INFO.source,
    upstreamModel: MUSICGEN_MODEL_INFO.upstreamModel,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return directory
}
