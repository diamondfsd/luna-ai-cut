import { stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  WorkspaceVisualAnalysisIntensity,
  WorkspaceVisualAnalysisRequest,
  WorkspaceVisualAnalysisResult,
} from '../src/shared/types'
import { SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS } from '../src/shared/segmentationModels'
import { analyzeContentTagsForFrame } from './aiSelectionSemantic'

const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'])

interface VisualAnalysisProfile {
  sampleIntervalSeconds: number
  maxSamples: number
  tagSensitivity: 'strict' | 'balanced' | 'sensitive'
}

const VISUAL_ANALYSIS_PROFILES: Record<WorkspaceVisualAnalysisIntensity, VisualAnalysisProfile> = {
  light: { sampleIntervalSeconds: 8, maxSamples: 2, tagSensitivity: 'strict' },
  normal: { sampleIntervalSeconds: 4, maxSamples: 4, tagSensitivity: 'balanced' },
  strong: { sampleIntervalSeconds: 2, maxSamples: 12, tagSensitivity: 'sensitive' },
}

export function resolveVisualAnalysisIntensity(value: unknown): WorkspaceVisualAnalysisIntensity {
  if (value === 'light' || value === 'strong') return value
  return 'normal'
}

export function getVisualAnalysisProfile(intensity: WorkspaceVisualAnalysisIntensity): VisualAnalysisProfile {
  return VISUAL_ANALYSIS_PROFILES[intensity]
}

function sampleTimes(durationSeconds: number, profile: VisualAnalysisProfile): number[] {
  const duration = Math.max(0.1, durationSeconds)
  const count = Math.min(profile.maxSamples, Math.max(1, Math.ceil(duration / profile.sampleIntervalSeconds)))
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

  const intensity = resolveVisualAnalysisIntensity(request.intensity)
  const profile = getVisualAnalysisProfile(intensity)
  const isImage = IMAGE_EXTENSIONS.has(path.extname(request.filePath).toLowerCase())
  const samples: WorkspaceVisualAnalysisResult['samples'] = []
  const times = isImage ? [0] : sampleTimes(request.durationSeconds, profile)
  onProgress?.({ label: '正在准备画面分析', percent: 0 })
  for (const [index, timeSeconds] of times.entries()) {
    signal?.throwIfAborted()
    onProgress?.({ label: `正在理解画面 ${index + 1}/${times.length}`, percent: index / times.length * 100 })
    const tags = await analyzeContentTagsForFrame(
      request.filePath,
      isImage ? undefined : timeSeconds,
      signal,
      profile.tagSensitivity,
    )
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
    intensity,
  }
}
