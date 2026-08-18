import { ipcMain } from 'electron'
import type {
  ManagedModelCategory,
  ManagedModelProgress,
  ManagedModelStatus,
} from '../src/shared/types'
import {
  AI_SELECTION_MODELS,
  SAM_MODELS,
  SEGMENTATION_MODELS,
  SPECIALIZED_SEGMENTATION_MODELS,
  type SamSegmentationModelId,
  type SegmentationModelPreparationId,
  type SegmentationModelId,
} from '../src/shared/segmentationModels'
import { DEFAULT_INPAINT_MODEL } from '../src/shared/inpaintModels'
import { SUBTITLE_MODEL_SET, getSubtitleModelsCacheStatus, loadSubtitleModels } from './subtitleModelService'
import { getModelCacheStatus, loadModel, loadSamModel, type ModelId } from './modelLoader'
import { getInpaintModelCacheStatus, loadInpaintModel } from './inpaintModelService'
import { stableAudio3ModelDownloadUrls, stableAudio3Runtime } from './stableAudio3Service'
import { mossTtsModelDownloadUrls, mossTtsRuntime } from './mossTtsService'

const SUBTITLE_MODEL_ID = 'subtitle:all'
const INPAINT_MODEL_ID = `inpaint:${DEFAULT_INPAINT_MODEL.id}`
const STABLE_AUDIO_MODEL_IDS = ['small-music', 'small-sfx'] as const
const MODEL_MANAGER_PROGRESS_CHANNEL = 'model-manager:progress'

type ManagedModelSource =
  | { kind: 'segmentation'; modelId: SegmentationModelPreparationId }
  | { kind: 'inpaint' }
  | { kind: 'subtitle' }
  | { kind: 'stable-audio'; modelId: (typeof STABLE_AUDIO_MODEL_IDS)[number] }
  | { kind: 'moss-tts' }

interface ManagedModelEntry extends ManagedModelStatus {
  source: ManagedModelSource
}

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls)]
}

function fileDownloadUrls(file: { url: string; mirrors?: readonly string[] }): string[] {
  return uniqueUrls([file.url, ...(file.mirrors ?? [])])
}

const SEGMENTATION_ENTRIES: ManagedModelEntry[] = [
  ...SEGMENTATION_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    category: 'segmentation' as ManagedModelCategory,
    sizeBytes: model.sizeBytes,
    downloadUrls: fileDownloadUrls(model),
    cached: false,
    available: true,
    source: { kind: 'segmentation' as const, modelId: model.id },
  })),
  ...SPECIALIZED_SEGMENTATION_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    category: 'segmentation' as ManagedModelCategory,
    sizeBytes: model.sizeBytes,
    downloadUrls: fileDownloadUrls(model),
    cached: false,
    available: true,
    source: { kind: 'segmentation' as const, modelId: model.id },
  })),
  ...SAM_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    category: 'segmentation' as ManagedModelCategory,
    sizeBytes: model.sizeBytes,
    downloadUrls: uniqueUrls(Object.values(model.files).flatMap(fileDownloadUrls)),
    cached: false,
    available: true,
    source: { kind: 'segmentation' as const, modelId: model.id },
  })),
  ...AI_SELECTION_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    category: 'selection' as ManagedModelCategory,
    sizeBytes: model.sizeBytes,
    downloadUrls: fileDownloadUrls(model),
    cached: false,
    available: true,
    source: { kind: 'segmentation' as const, modelId: model.id },
  })),
]

const MODEL_ENTRIES: ManagedModelEntry[] = [
  ...SEGMENTATION_ENTRIES,
  {
    id: INPAINT_MODEL_ID,
    name: 'LaMa 消除模型',
    description: '用于移除画面中的对象。',
    category: 'removal',
    sizeBytes: DEFAULT_INPAINT_MODEL.sizeBytes,
    downloadUrls: fileDownloadUrls(DEFAULT_INPAINT_MODEL),
    cached: false,
    available: true,
    source: { kind: 'inpaint' },
  },
  {
    id: SUBTITLE_MODEL_ID,
    name: '字幕识别套件',
    description: `包含语音识别、语音分段和中文字幕标点，共 ${SUBTITLE_MODEL_SET.length} 个模型。`,
    category: 'subtitle',
    sizeBytes: SUBTITLE_MODEL_SET.reduce((total, model) => total + model.sizeBytes, 0),
    downloadUrls: uniqueUrls(SUBTITLE_MODEL_SET.flatMap(fileDownloadUrls)),
    cached: false,
    available: true,
    source: { kind: 'subtitle' },
  },
  {
    id: 'stable-audio:small-music',
    name: 'Stable Audio 3 背景音乐',
    description: '生成背景音乐、旋律和氛围配乐。',
    category: 'audio',
    sizeBytes: 0,
    downloadUrls: [],
    cached: false,
    available: false,
    source: { kind: 'stable-audio', modelId: 'small-music' },
  },
  {
    id: 'stable-audio:small-sfx',
    name: 'Stable Audio 3 音效',
    description: '生成短音效和环境声音。',
    category: 'audio',
    sizeBytes: 0,
    downloadUrls: [],
    cached: false,
    available: false,
    source: { kind: 'stable-audio', modelId: 'small-sfx' },
  },
  {
    id: 'moss-tts:nano',
    name: 'MOSS TTS Nano',
    description: '生成旁白和配音。',
    category: 'tts',
    sizeBytes: 0,
    downloadUrls: [],
    cached: false,
    available: false,
    source: { kind: 'moss-tts' },
  },
]

function reportProgress(
  sender: Electron.WebContents,
  modelId: string,
  stage: string,
  completedBytes: number,
  totalBytes: number,
): void {
  if (sender.isDestroyed()) return
  const progress: ManagedModelProgress = {
    modelId,
    stage,
    completedBytes: Math.max(0, completedBytes),
    totalBytes: Math.max(0, totalBytes),
    fraction: totalBytes > 0 ? Math.max(0, Math.min(1, completedBytes / totalBytes)) : null,
  }
  sender.send(MODEL_MANAGER_PROGRESS_CHANNEL, progress)
}

function entryForId(modelId: unknown): ManagedModelEntry {
  if (typeof modelId !== 'string') throw new Error('模型编号无效。')
  const entry = MODEL_ENTRIES.find((item) => item.id === modelId)
  if (!entry) throw new Error('未找到对应的模型。')
  return entry
}

async function listStatuses(): Promise<ManagedModelStatus[]> {
  const [segmentationStatuses, inpaint, subtitles, stableAudio, mossTts] = await Promise.all([
    Promise.all(SEGMENTATION_ENTRIES.map((entry) => getModelCacheStatus(entry.source.kind === 'segmentation' ? entry.source.modelId : entry.id as SegmentationModelId))),
    getInpaintModelCacheStatus(),
    getSubtitleModelsCacheStatus(),
    stableAudio3Runtime.status(),
    mossTtsRuntime.status(),
  ])
  const segmentationById = new Map(segmentationStatuses.map((status) => [status.modelId, status]))
  const stableAudioById = new Map(stableAudio.models.map((status) => [status.id, status]))

  return MODEL_ENTRIES.map(({ source, ...entry }) => {
    if (source.kind === 'segmentation') {
      return { ...entry, cached: segmentationById.get(source.modelId)?.cached ?? false, available: true }
    }
    if (source.kind === 'inpaint') return { ...entry, cached: inpaint.cached, available: true }
    if (source.kind === 'subtitle') return { ...entry, cached: subtitles.cached, available: true }
    if (source.kind === 'stable-audio') {
      const status = stableAudioById.get(source.modelId)
      return {
        ...entry,
        sizeBytes: status?.estimatedBytes ?? entry.sizeBytes,
        downloadUrls: stableAudio3ModelDownloadUrls(source.modelId),
        cached: status?.cached ?? false,
        available: stableAudio.supported,
      }
    }
    return {
      ...entry,
      sizeBytes: mossTts.estimatedBytes,
      downloadUrls: mossTtsModelDownloadUrls(),
      cached: mossTts.modelCached,
      available: mossTts.supported,
    }
  })
}

async function prepareEntry(entry: ManagedModelEntry, sender: Electron.WebContents): Promise<void> {
  const report = (stage: string, completedBytes: number, totalBytes: number) => {
    reportProgress(sender, entry.id, stage, completedBytes, totalBytes || entry.sizeBytes)
  }

  switch (entry.source.kind) {
    case 'segmentation': {
      const modelId = entry.source.modelId
      if (SAM_MODELS.some((model) => model.id === modelId)) {
        await loadSamModel(modelId as SamSegmentationModelId, (progress) => report('正在下载模型', progress.completedBytes, progress.totalBytes))
      } else {
        await loadModel(modelId as ModelId, (progress) => report('正在下载模型', progress.completedBytes, progress.totalBytes))
      }
      return
    }
    case 'inpaint':
      await loadInpaintModel(undefined, (progress) => report('正在下载模型', progress.completedBytes, progress.totalBytes))
      return
    case 'subtitle':
      await loadSubtitleModels(undefined, (progress) => report('正在下载字幕模型', progress.completedBytes, progress.totalBytes))
      return
    case 'stable-audio':
      await stableAudio3Runtime.prepareModel(entry.source.modelId, (progress) => report(
        progress.stage,
        progress.loadedBytes ?? (progress.fraction === null ? 0 : progress.fraction * entry.sizeBytes),
        progress.totalBytes ?? entry.sizeBytes,
      ))
      return
    case 'moss-tts':
      await mossTtsRuntime.prepare((progress) => report(
        progress.stage,
        progress.loadedBytes ?? (progress.fraction === null ? 0 : progress.fraction * entry.sizeBytes),
        progress.totalBytes ?? entry.sizeBytes,
      ))
  }
}

export function register(): void {
  ipcMain.handle('model-manager:list', () => listStatuses())
  ipcMain.handle('model-manager:prepare', async (event, modelId: unknown) => {
    const entry = entryForId(modelId)
    await prepareEntry(entry, event.sender)
    const statuses = await listStatuses()
    const status = statuses.find((item) => item.id === entry.id)
    if (!status) throw new Error('模型状态读取失败。')
    reportProgress(event.sender, entry.id, '模型已准备', status.sizeBytes, status.sizeBytes)
    return status
  })
}
