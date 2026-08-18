import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_INPAINT_MODEL } from '../src/shared/inpaintModels'
import { loadVerifiedModelFile } from './modelFileService'
import { getSettings, modelCacheDirForBaseDir } from './settingsService'

export const INPAINT_MODEL = DEFAULT_INPAINT_MODEL

let pending: Promise<string> | null = null

async function verifiedLocalModel(candidate: string | undefined): Promise<string | null> {
  if (!candidate) return null
  const info = await stat(candidate).catch(() => null)
  if (!info?.isFile() || info.size !== INPAINT_MODEL.sizeBytes) return null
  const digest = await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(candidate)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
  return digest === INPAINT_MODEL.sha256 ? candidate : null
}

export async function loadInpaintModel(signal?: AbortSignal): Promise<string> {
  const modelDir = path.join(modelCacheDirForBaseDir((await getSettings()).baseDir), INPAINT_MODEL.id)
  const local = await verifiedLocalModel(process.env.LUNA_LAMA_MODEL_PATH)
    ?? await verifiedLocalModel(path.join(modelDir, INPAINT_MODEL.fileName))
  if (local) return local
  if (!pending) {
    pending = (async () => {
      await mkdir(modelDir, { recursive: true })
      try {
        return await loadVerifiedModelFile(modelDir, INPAINT_MODEL, { signal })
      } catch (error) {
        if (signal?.aborted) throw error
        throw new Error(`消除模型下载失败，请检查网络后重试${error instanceof Error && error.message ? `：${error.message}` : ''}`)
      }
    })().finally(() => { pending = null })
  }
  return pending
}
