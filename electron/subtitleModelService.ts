import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { SUBTITLE_ASR_MODEL, SUBTITLE_VAD_MODEL } from '../src/shared/subtitleModels'
import { loadVerifiedModelFile, type ModelFileProgress } from './modelFileService'

export interface SubtitleModelPaths {
  asr: string
  vad: string
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
      const vadDir = path.join(root, SUBTITLE_VAD_MODEL.id)
      await Promise.all([mkdir(asrDir, { recursive: true }), mkdir(vadDir, { recursive: true })])
      const asr = await loadVerifiedModelFile(asrDir, SUBTITLE_ASR_MODEL, { signal, onProgress })
      const vad = await loadVerifiedModelFile(vadDir, SUBTITLE_VAD_MODEL, { signal })
      return { asr, vad }
    })().finally(() => { pending = null })
  }
  return pending
}
