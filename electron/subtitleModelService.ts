import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { SUBTITLE_ASR_MODEL, SUBTITLE_PUNCTUATION_MODEL, SUBTITLE_VAD_MODEL } from '../src/shared/subtitleModels'
import { loadVerifiedModelFile, type ModelFileProgress } from './modelFileService'
import { hasCachedModelFiles } from './modelCacheStatus'
import { getSettings, modelCacheDirForBaseDir } from './settingsService'

export interface SubtitleModelPaths {
  asr: string
  vad: string
  punctuation: string
}

let pending: Promise<SubtitleModelPaths> | null = null

export const SUBTITLE_MODEL_SET = [SUBTITLE_ASR_MODEL, SUBTITLE_VAD_MODEL, SUBTITLE_PUNCTUATION_MODEL] as const

export async function getSubtitleModelsCacheStatus(): Promise<{ cached: boolean; sizeBytes: number }> {
  const root = modelCacheDirForBaseDir((await getSettings()).baseDir)
  const cached = await Promise.all(SUBTITLE_MODEL_SET.map(async (definition) => {
    const modelDir = path.join(root, definition.id)
    return hasCachedModelFiles(modelDir, [definition])
  })).then((values) => values.every(Boolean))
  return {
    cached,
    sizeBytes: SUBTITLE_MODEL_SET.reduce((total, definition) => total + definition.sizeBytes, 0),
  }
}

export async function loadSubtitleModels(
  signal?: AbortSignal,
  onProgress?: (progress: ModelFileProgress) => void,
): Promise<SubtitleModelPaths> {
  if (!pending) {
    pending = (async () => {
      const root = modelCacheDirForBaseDir((await getSettings()).baseDir)
      const asrDir = path.join(root, SUBTITLE_ASR_MODEL.id)
      const vadDir = path.join(root, SUBTITLE_VAD_MODEL.id)
      const punctuationDir = path.join(root, SUBTITLE_PUNCTUATION_MODEL.id)
      await Promise.all([mkdir(asrDir, { recursive: true }), mkdir(vadDir, { recursive: true }), mkdir(punctuationDir, { recursive: true })])
      const definitions = SUBTITLE_MODEL_SET
      const totalBytes = definitions.reduce((total, definition) => total + definition.sizeBytes, 0)
      let completedBefore = 0
      const load = async (directory: string, definition: typeof definitions[number]): Promise<string> => {
        const result = await loadVerifiedModelFile(directory, definition, {
          signal,
          onProgress: (progress) => onProgress?.({ completedBytes: completedBefore + progress.completedBytes, totalBytes }),
        })
        completedBefore += definition.sizeBytes
        return result
      }
      const asr = await load(asrDir, SUBTITLE_ASR_MODEL)
      const vad = await load(vadDir, SUBTITLE_VAD_MODEL)
      const punctuation = await load(punctuationDir, SUBTITLE_PUNCTUATION_MODEL)
      return { asr, vad, punctuation }
    })().finally(() => { pending = null })
  }
  return pending
}
