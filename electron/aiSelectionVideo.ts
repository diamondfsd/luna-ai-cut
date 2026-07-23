import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AiVideoKeyframe, AiVideoSegment } from '../src/shared/types'
import { analyzeRgb } from './aiSelectionAlgorithms'
import type { IndexedMedia } from './aiSelectionMedia'
import { getFfmpegPath } from './ffmpeg/pipeline'

interface VideoStory {
  keyframes: AiVideoKeyframe[]
  segments: AiVideoSegment[]
}

function run(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { signal, maxBuffer: 1024 * 1024 }, (error) => error ? reject(error) : resolve())
  })
}

function sampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0.2) return [0.1]
  const margin = Math.min(0.5, duration * 0.08)
  return [...new Set([margin, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(margin, duration - margin)]
    .map((time) => Number(Math.max(0.05, Math.min(duration - 0.05, time)).toFixed(3))))]
}

function segmentBounds(times: number[], duration: number, index: number): [number, number] {
  const start = index === 0 ? 0 : (times[index - 1] + times[index]) / 2
  const end = index === times.length - 1 ? duration : (times[index] + times[index + 1]) / 2
  return [Number(start.toFixed(3)), Number(Math.max(start + 0.1, end).toFixed(3))]
}

function storyId(media: IndexedMedia, times: number[]): string {
  return createHash('sha1').update(`v3\0${media.id}\0${media.mtimeMs}\0${times.join(',')}`).digest('hex').slice(0, 16)
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0; let aNorm = 0; let bNorm = 0
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) { dot += a[index] * b[index]; aNorm += a[index] ** 2; bNorm += b[index] ** 2 }
  return 1 - dot / Math.max(Number.EPSILON, Math.sqrt(aNorm * bNorm))
}

function frameTags(quality: ReturnType<typeof analyzeRgb>['quality']): string[] {
  const tags: string[] = []
  if (quality.luminanceMean < 72) tags.push('夜景', '暗光')
  else if (quality.luminanceMean > 188) tags.push('明亮')
  else tags.push('正常光线')
  if (quality.contrast > 48) tags.push('高对比')
  if (quality.edgeScore > 16) tags.push('细节丰富')
  if (quality.grade === 'review') tags.push('建议复查')
  return tags
}

async function readCachedStory(manifestPath: string): Promise<VideoStory | null> {
  try {
    const story = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as VideoStory
    if (story.keyframes.length === 0) return null
    const valid = await Promise.all(story.keyframes.map(async (frame) => {
      try { return (await fs.stat(new URL(frame.thumbnailUrl))).isFile() } catch { return false }
    }))
    return valid.every(Boolean) ? story : null
  } catch {
    return null
  }
}

export async function analyzeVideoStory(
  media: IndexedMedia,
  duration: number,
  cacheRoot: string,
  signal?: AbortSignal,
): Promise<VideoStory> {
  signal?.throwIfAborted()
  const times = sampleTimes(duration)
  const directory = path.join(cacheRoot, media.id, `story-${storyId(media, times)}`)
  const manifestPath = path.join(directory, 'manifest.json')
  const cached = await readCachedStory(manifestPath)
  if (cached) return cached
  await fs.mkdir(directory, { recursive: true })

  const rawPaths = times.map((_, index) => path.join(directory, `${index}.rgb`))
  const imagePaths = times.map((_, index) => path.join(directory, `${index}.jpg`))
  const args = ['-y', '-v', 'error']
  for (const time of times) args.push('-ss', time.toFixed(3), '-i', media.path)
  for (let index = 0; index < times.length; index += 1) {
    args.push('-map', `${index}:v:0`, '-frames:v', '1', '-vf', 'scale=64:64', '-pix_fmt', 'rgb24', '-f', 'rawvideo', rawPaths[index])
    args.push('-map', `${index}:v:0`, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', imagePaths[index])
  }
  await run(getFfmpegPath(), args, signal)

  const keyframes: AiVideoKeyframe[] = []
  const segments: AiVideoSegment[] = []
  let previousSignature: number[] | null = null
  for (let index = 0; index < times.length; index += 1) {
    const rgb = await fs.readFile(rawPaths[index], { signal })
    if (rgb.byteLength !== 64 * 64 * 3) throw new Error('视频关键帧读取不完整')
    const analysis = analyzeRgb(rgb, 64, 64)
    const quality = analysis.quality
    const changeScore = previousSignature ? Number(cosineDistance(previousSignature, analysis.visualSignature).toFixed(3)) : null
    previousSignature = analysis.visualSignature
    const id = `${media.id}_frame_${index}`
    keyframes.push({ id, time: times[index], thumbnailUrl: pathToFileURL(imagePaths[index]).toString(), quality, semanticTags: [...frameTags(quality), ...(changeScore != null && changeScore > 0.18 ? ['镜头变化'] : [])], changeScore })
    const [startTime, endTime] = segmentBounds(times, duration, index)
    segments.push({
      id: `${media.id}_segment_${index}`,
      startTime,
      endTime,
      status: quality.grade === 'review' ? 'review' : 'usable',
      reasons: quality.reasons,
      state: status === 'usable' ? 'recommended' : 'undecided',
      decisionSource: 'ai',
    })
    await fs.rm(rawPaths[index], { force: true })
  }
  const story = { keyframes, segments }
  await fs.writeFile(manifestPath, `${JSON.stringify(story, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return story
}
