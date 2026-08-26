import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { SUBTITLE_ASR_MODEL, SUBTITLE_ASR_TOKENS_MODEL, SUBTITLE_PUNCTUATION_MODEL, SUBTITLE_VAD_MODEL } from '../../../src/shared/subtitleModels'
import { loadVerifiedModelFile, type ModelFileProgress } from '../../infrastructure/modelFileService'

export interface SubtitleModelPaths {
  asr: string
  tokens: string
  vad: string
  punctuation: string
}

let pending: Promise<SubtitleModelPaths> | null = null

export async function loadSubtitleModels(
  signal?: AbortSignal,
  onProgress?: (progress: ModelFileProgress) => void,
): Promise<SubtitleModelPaths> {
  if (!pending) {
    pending = (async () => {
      const root = path.join(app.getPath('userData'), 'models')
      const asrDir = path.join(root, SUBTITLE_ASR_MODEL.id)
      const tokensDir = path.join(root, SUBTITLE_ASR_TOKENS_MODEL.id)
      const vadDir = path.join(root, SUBTITLE_VAD_MODEL.id)
      const punctuationDir = path.join(root, SUBTITLE_PUNCTUATION_MODEL.id)
      await Promise.all([mkdir(asrDir, { recursive: true }), mkdir(tokensDir, { recursive: true }), mkdir(vadDir, { recursive: true }), mkdir(punctuationDir, { recursive: true })])
      const definitions = [SUBTITLE_ASR_MODEL, SUBTITLE_ASR_TOKENS_MODEL, SUBTITLE_VAD_MODEL, SUBTITLE_PUNCTUATION_MODEL]
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
      const tokens = await load(tokensDir, SUBTITLE_ASR_TOKENS_MODEL)
      const vad = await load(vadDir, SUBTITLE_VAD_MODEL)
      const punctuation = await load(punctuationDir, SUBTITLE_PUNCTUATION_MODEL)
      return { asr, tokens, vad, punctuation }
    })().finally(() => { pending = null })
  }
  return pending
}
