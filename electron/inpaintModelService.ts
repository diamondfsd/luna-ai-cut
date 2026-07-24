import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadVerifiedModelFile } from './modelFileService'

export const INPAINT_MODEL = {
  id: 'big-lama-fp32' as const,
  version: 'carve-c3c0c9e' as const,
  fileName: 'lama_fp32.onnx',
  url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx',
  sha256: '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6',
  sizeBytes: 208_044_816,
  license: 'Apache-2.0',
  source: 'https://huggingface.co/Carve/LaMa-ONNX',
} as const

let pending: Promise<string> | null = null

function developmentCacheModel(): string {
  const root = process.platform === 'darwin'
    ? path.join(app.getPath('home'), 'Library', 'Caches')
    : process.platform === 'win32'
      ? app.getPath('appData')
      : process.env.XDG_CACHE_HOME ?? path.join(app.getPath('home'), '.cache')
  return path.join(root, 'LunaAICut', 'models', INPAINT_MODEL.id, INPAINT_MODEL.fileName)
}

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
  const local = await verifiedLocalModel(process.env.LUNA_LAMA_MODEL_PATH)
    ?? await verifiedLocalModel(developmentCacheModel())
  if (local) return local
  if (!pending) {
    pending = (async () => {
      const directory = path.join(app.getPath('userData'), 'models', INPAINT_MODEL.id)
      await mkdir(directory, { recursive: true })
      try {
        return await loadVerifiedModelFile(directory, INPAINT_MODEL, { signal })
      } catch (error) {
        if (signal?.aborted) throw error
        throw new Error(`消除模型下载失败，请检查网络后重试${error instanceof Error && error.message ? `：${error.message}` : ''}`)
      }
    })().finally(() => { pending = null })
  }
  return pending
}
