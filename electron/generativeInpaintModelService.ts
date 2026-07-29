import { app } from 'electron'
import { access, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { loadVerifiedModelFile } from './modelFileService'

export const GENERATIVE_INPAINT_MODEL = {
  id: 'stable-diffusion-v1-5-inpainting-q4-0' as const,
  version: 'gpustack-master-20260729' as const,
  fileName: 'stable-diffusion-v1-5-inpainting-Q4_0.gguf',
  url: 'https://modelscope.cn/models/gpustack/stable-diffusion-v1-5-inpainting-GGUF/resolve/master/stable-diffusion-v1-5-inpainting-Q4_0.gguf',
  sha256: 'd157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16',
  sizeBytes: 1_747_219_584,
  license: 'CreativeML OpenRAIL-M',
  source: 'https://modelscope.cn/models/gpustack/stable-diffusion-v1-5-inpainting-GGUF',
} as const

function modelDirectory(): string {
  return path.join(app.getPath('userData'), 'models', GENERATIVE_INPAINT_MODEL.id)
}

async function usableFile(candidate: string | undefined, expectedBytes: number): Promise<string | null> {
  if (!candidate) return null
  const info = await stat(candidate).catch(() => null)
  return info?.isFile() && info.size === expectedBytes ? candidate : null
}

export async function getCachedGenerativeInpaintModel(): Promise<string | null> {
  return await usableFile(process.env.LUNA_SD_INPAINT_MODEL_PATH, GENERATIVE_INPAINT_MODEL.sizeBytes)
    ?? await usableFile(path.join(modelDirectory(), GENERATIVE_INPAINT_MODEL.fileName), GENERATIVE_INPAINT_MODEL.sizeBytes)
}

export async function loadGenerativeInpaintModel(signal?: AbortSignal): Promise<string> {
  const override = await usableFile(process.env.LUNA_SD_INPAINT_MODEL_PATH, GENERATIVE_INPAINT_MODEL.sizeBytes)
  if (override) return override
  const directory = modelDirectory()
  await mkdir(directory, { recursive: true })
  try {
    return await loadVerifiedModelFile(directory, GENERATIVE_INPAINT_MODEL, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`生成式重建模型下载失败，请检查网络后重试${error instanceof Error && error.message ? `：${error.message}` : ''}`)
  }
}

export async function resolveGenerativeRuntime(): Promise<string | null> {
  const name = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli'
  const candidates = [
    process.env.LUNA_SD_CLI_PATH,
    app.isPackaged ? path.join(process.resourcesPath, 'luna-render-core', name) : undefined,
    !app.isPackaged ? path.join(process.env.APP_ROOT ?? path.join(import.meta.dirname, '..'), 'luna-render-core', name) : undefined,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (await access(candidate, constants.X_OK).then(() => true).catch(() => false)) return candidate
  }
  return null
}
