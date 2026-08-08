import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceVisualAnalysisRequest, WorkspaceVisualAnalysisResult } from '../src/shared/types'
import { SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS } from '../src/shared/segmentationModels'
import { analyzeContentTagsForFrame } from './aiSelectionSemantic'

const DEFAULT_MAX_SAMPLES = 12
const MAX_SAMPLES = 24
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'])

function sampleTimes(durationSeconds: number, maxSamples: number): number[] {
  const duration = Math.max(0.1, durationSeconds)
  const count = Math.min(maxSamples, Math.max(1, Math.ceil(duration / 4)))
  const edge = Math.min(0.25, duration / 4)
  if (count === 1) return [Number(Math.min(edge, duration / 2).toFixed(3))]
  return Array.from({ length: count }, (_, index) => Number((
    edge + index * (duration - edge * 2) / (count - 1)
  ).toFixed(3)))
}

export async function analyzeVisualEvidence(
  request: WorkspaceVisualAnalysisRequest,
  signal?: AbortSignal,
  onProgress?: (progress: { label: string; percent: number }) => void,
): Promise<WorkspaceVisualAnalysisResult> {
  const source = await stat(request.filePath)
  if (!source.isFile()) throw new Error('素材文件无效')

  const requestedMaxSamples = Number.isFinite(request.maxSamples)
    ? request.maxSamples!
    : DEFAULT_MAX_SAMPLES
  const maxSamples = Math.max(1, Math.min(MAX_SAMPLES, Math.round(requestedMaxSamples)))
  const isImage = IMAGE_EXTENSIONS.has(path.extname(request.filePath).toLowerCase())
  const samples: WorkspaceVisualAnalysisResult['samples'] = []
  const times = sampleTimes(request.durationSeconds, maxSamples)
  onProgress?.({ label: '正在准备画面分析', percent: 0 })
  for (const [index, timeSeconds] of times.entries()) {
    signal?.throwIfAborted()
    onProgress?.({ label: `正在理解画面 ${index + 1}/${times.length}`, percent: index / times.length * 100 })
    const tags = await analyzeContentTagsForFrame(request.filePath, isImage ? undefined : timeSeconds, signal)
    samples.push({ timeSeconds, tags })
    onProgress?.({ label: `已理解画面 ${index + 1}/${times.length}`, percent: (index + 1) / times.length * 100 })
  }

  const yolo = SPECIALIZED_SEGMENTATION_MODELS.find((model) => model.id === 'yolo26s-seg')!
  const scene = SEGMENTATION_MODELS.find((model) => model.id === 'segformer-b5-ade20k')!
  return {
    requestId: request.requestId,
    samples,
    models: [
      { id: yolo.id, version: yolo.version },
      { id: scene.id, version: scene.version },
    ],
    sourceFingerprint: { size: source.size, modifiedAtMs: source.mtimeMs },
  }
}
