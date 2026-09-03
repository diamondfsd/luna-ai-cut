import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

import {
  compositionEvidenceFromMask,
  compositionEvidenceFromModel,
  compositionScoreFromModel,
  type CompositionEvidence,
  type CompositionScore,
} from '../../../src/shared/compositionAnalysis'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { loadModel } from '../../infrastructure/modelLoader'
import { scoreCompositionInWorker, segmentSpecializedInWorker } from '../segmentation/specializedSegmentationService'

const execFileAsync = promisify(execFile)
const COMPOSITION_INPUT_SIZE = 224
const SUBJECT_INPUT_SIZE = 1024
const SUBJECT_OUTPUT_SIZE = 512
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.m2ts', '.insv', '.lrv', '.m4v'])

interface NormalizedCrop {
  x: number
  y: number
  width: number
  height: number
}

function safeFrameTime(filePath: string, frameTime: number | undefined): number | undefined {
  const extension = path.extname(filePath).toLowerCase()
  return VIDEO_EXTENSIONS.has(extension) && frameTime !== undefined
    ? Math.max(0, frameTime)
    : undefined
}

function boundedCrop(crop: NormalizedCrop): NormalizedCrop {
  const x = Math.min(1, Math.max(0, crop.x))
  const y = Math.min(1, Math.max(0, crop.y))
  const width = Math.min(1 - x, Math.max(0.01, crop.width))
  const height = Math.min(1 - y, Math.max(0.01, crop.height))
  return { x, y, width, height }
}

async function decodeCompositionInput(filePath: string, frameTime: number | undefined, signal?: AbortSignal): Promise<Buffer> {
  const { stdout } = await execFileAsync(getFfmpegPath(), [
    '-v', 'error',
    ...(frameTime !== undefined ? ['-ss', String(frameTime)] : []),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', `scale=${COMPOSITION_INPUT_SIZE}:${COMPOSITION_INPUT_SIZE}:flags=bilinear`,
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    'pipe:1',
  ], {
    encoding: 'buffer',
    maxBuffer: COMPOSITION_INPUT_SIZE * COMPOSITION_INPUT_SIZE * 3 + 1024,
    signal,
  })
  const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (rgb.byteLength !== COMPOSITION_INPUT_SIZE * COMPOSITION_INPUT_SIZE * 3) throw new Error('无法读取用于构图分析的画面')
  return rgb
}

async function decodeSubjectInput(filePath: string, frameTime: number | undefined, signal?: AbortSignal): Promise<Buffer> {
  const { stdout } = await execFileAsync(getFfmpegPath(), [
    '-v', 'error',
    ...(frameTime !== undefined ? ['-ss', String(frameTime)] : []),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', `scale=${SUBJECT_INPUT_SIZE}:${SUBJECT_INPUT_SIZE}:flags=bilinear`,
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    'pipe:1',
  ], {
    encoding: 'buffer',
    maxBuffer: SUBJECT_INPUT_SIZE * SUBJECT_INPUT_SIZE * 3 + 1024,
    signal,
  })
  const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (rgb.byteLength !== SUBJECT_INPUT_SIZE * SUBJECT_INPUT_SIZE * 3) throw new Error('无法读取用于主体保护的画面')
  return rgb
}

export async function analyzeCompositionSubject(
  filePath: string,
  frameTime?: number,
  signal?: AbortSignal,
  includeSubjectMask = false,
): Promise<CompositionEvidence> {
  const safeTime = safeFrameTime(filePath, frameTime)
  const relicPromise = Promise.all([
    loadModel('relic2-cpc', undefined, signal),
    decodeCompositionInput(filePath, safeTime, signal),
  ])
  const subjectPromise = includeSubjectMask
    ? Promise.all([
      loadModel('rmbg-1.4', undefined, signal),
      decodeSubjectInput(filePath, safeTime, signal),
    ])
    : null
  const [[relicModel, relicRgb], subject] = await Promise.all([relicPromise, subjectPromise])
  const scorePromise = scoreCompositionInWorker(relicModel.path, relicRgb, signal)
  const maskPromise = subject
    ? segmentSpecializedInWorker({
      backend: 'rmbg-1.4',
      modelPath: subject[0].path,
      rgb: subject[1],
      scaledWidth: SUBJECT_INPUT_SIZE,
      scaledHeight: SUBJECT_INPUT_SIZE,
      padX: 0,
      padY: 0,
      outputSize: SUBJECT_OUTPUT_SIZE,
    }, signal)
    : null
  const [score, mask] = await Promise.all([scorePromise, maskPromise])
  if (!mask) return compositionEvidenceFromModel(score.raw)
  const maskEvidence = compositionEvidenceFromMask(mask.bytes, mask.width, mask.height)
  return compositionEvidenceFromModel(score.raw, {
    coverage: maskEvidence.coverage,
    bounds: maskEvidence.bounds,
  })
}

async function decodeCompositionCrop(
  filePath: string,
  frameTime: number | undefined,
  crop: NormalizedCrop,
  signal?: AbortSignal,
): Promise<Buffer> {
  const bounded = boundedCrop(crop)
  const filter = `crop=w=iw*${bounded.width}:h=ih*${bounded.height}:x=iw*${bounded.x}:y=ih*${bounded.y},scale=${COMPOSITION_INPUT_SIZE}:${COMPOSITION_INPUT_SIZE}:flags=bilinear`
  const { stdout } = await execFileAsync(getFfmpegPath(), [
    '-v', 'error',
    ...(frameTime !== undefined ? ['-ss', String(frameTime)] : []),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', filter,
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    'pipe:1',
  ], {
    encoding: 'buffer',
    maxBuffer: COMPOSITION_INPUT_SIZE * COMPOSITION_INPUT_SIZE * 3 + 1024,
    signal,
  })
  const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (rgb.byteLength !== COMPOSITION_INPUT_SIZE * COMPOSITION_INPUT_SIZE * 3) throw new Error('无法读取候选裁剪画面')
  return rgb
}

export async function scoreCompositionCrops(
  filePath: string,
  frameTime: number | undefined,
  crops: NormalizedCrop[],
  signal?: AbortSignal,
): Promise<CompositionScore[]> {
  if (crops.length > 32) throw new Error('候选裁剪数量过多')
  const safeTime = safeFrameTime(filePath, frameTime)
  const model = await loadModel('relic2-cpc', undefined, signal)
  const scores: CompositionScore[] = []
  for (const crop of crops) {
    signal?.throwIfAborted()
    const rgb = await decodeCompositionCrop(filePath, safeTime, crop, signal)
    const result = await scoreCompositionInWorker(model.path, rgb, signal)
    scores.push(compositionScoreFromModel(result.raw))
  }
  return scores
}
