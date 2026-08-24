import { app } from 'electron'
import * as os from 'node:os'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { AiSelectionItem } from '../src/shared/types'

import { analyzeIndexedMedia, indexMediaSource } from '../electron/features/ai-selection/aiSelectionMedia'
import { applySelectionPlan, buildShootingEvents, buildSimilarityGroups } from '../electron/features/ai-selection/aiSelectionAlgorithms'
import { analyzePersonEvidence } from '../electron/features/ai-selection/aiSelectionPerson'
import { analyzeVideoStory } from '../electron/features/ai-selection/aiSelectionVideo'

interface BenchmarkResult {
  indexMs: number
  total: number
  photos: number
  videos: number
  photoMs: number
  videoMs: number
  failures: Array<{ name: string; kind: string; error: string }>
}

async function run(): Promise<void> {
  const directory = process.env.LUNA_AI_SELECTION_BENCHMARK_DIR
  if (!directory) throw new Error('请通过 LUNA_AI_SELECTION_BENCHMARK_DIR 指定测试目录')
  const result: BenchmarkResult = { indexMs: 0, total: 0, photos: 0, videos: 0, photoMs: 0, videoMs: 0, failures: [] }
  const indexStarted = performance.now()
  const indexed = await indexMediaSource({ kind: 'directory', directory })
  result.indexMs = Math.round(performance.now() - indexStarted)
  result.total = indexed.length
  if (process.env.LUNA_AI_SELECTION_BENCHMARK_STORY === '1') {
    const limit = Math.max(1, Number(process.env.LUNA_AI_SELECTION_BENCHMARK_STORY_LIMIT ?? 1))
    const mediaItems = indexed.filter((item) => item.kind === 'video').slice(0, limit)
    if (mediaItems.length === 0) throw new Error('目录中没有视频')
    const started = performance.now()
    const durations: number[] = []
    for (const media of mediaItems) {
      const itemStarted = performance.now()
      const item = await analyzeIndexedMedia(media, 'balanced', false)
      const story = await analyzeVideoStory(media, item.duration ?? 1, path.join(app.getPath('userData'), '.luna-cache', 'ai-selection-benchmark'))
      const elapsedMs = Math.round(performance.now() - itemStarted)
      durations.push(elapsedMs)
      console.log(JSON.stringify({ type: 'story', name: media.name, keyframes: story.keyframes.length, segments: story.segments.length, elapsedMs, tags: [...new Set(story.keyframes.flatMap((frame) => frame.semanticTags))] }))
    }
    durations.sort((a, b) => a - b)
    console.log(JSON.stringify({ type: 'story-summary', count: mediaItems.length, elapsedMs: Math.round(performance.now() - started), p50Ms: durations[Math.floor(durations.length * 0.5)], p95Ms: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))], rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }))
    return
  }
  if (process.env.LUNA_AI_SELECTION_BENCHMARK_PERSON === '1') {
    const limit = Math.max(1, Number(process.env.LUNA_AI_SELECTION_BENCHMARK_PERSON_LIMIT ?? 1))
    const mediaItems = indexed.filter((item) => item.kind === 'image').slice(0, limit)
    if (mediaItems.length === 0) throw new Error('目录中没有照片')
    const started = performance.now()
    for (const media of mediaItems) {
      const item = await analyzeIndexedMedia(media, 'balanced', false)
      console.log(JSON.stringify({ type: 'person', name: media.name, evidence: await analyzePersonEvidence(item) }))
    }
    console.log(JSON.stringify({ type: 'person-summary', count: mediaItems.length, elapsedMs: Math.round(performance.now() - started), rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }))
    return
  }
  const sizeCounts = new Map<number, number>()
  const analyzedItems: AiSelectionItem[] = []
  indexed.forEach((item) => sizeCounts.set(item.bytes, (sizeCounts.get(item.bytes) ?? 0) + 1))

  const requestedKind = process.env.LUNA_AI_SELECTION_BENCHMARK_KIND
  const kinds = (requestedKind === 'image' || requestedKind === 'video' ? [requestedKind] : ['image', 'video']) as Array<'image' | 'video'>
  for (const kind of kinds) {
    const mediaItems = indexed.filter((item) => item.kind === kind)
    const started = performance.now()
    let completed = 0
    const concurrency = kind === 'image' ? 3 : os.totalmem() >= 16 * 1024 ** 3 ? 2 : 1
    for (let offset = 0; offset < mediaItems.length; offset += concurrency) {
      const batch = mediaItems.slice(offset, offset + concurrency)
      await Promise.all(batch.map(async (media) => {
        try {
          analyzedItems.push(await analyzeIndexedMedia(media, 'balanced', kind === 'image' && (sizeCounts.get(media.bytes) ?? 0) > 1))
        } catch (error) {
          result.failures.push({ name: media.name, kind, error: error instanceof Error ? error.message : String(error) })
        }
      }))
      completed += batch.length
      if (completed % 25 === 0 || completed === mediaItems.length) {
        console.log(JSON.stringify({ type: 'progress', kind, completed, total: mediaItems.length, elapsedMs: Math.round(performance.now() - started) }))
      }
    }
    const elapsed = Math.round(performance.now() - started)
    if (kind === 'image') { result.photos = mediaItems.length; result.photoMs = elapsed }
    else { result.videos = mediaItems.length; result.videoMs = elapsed }
  }
  const events = buildShootingEvents(analyzedItems)
  const groups = buildSimilarityGroups(analyzedItems, events)
  const automaticItems = structuredClone(analyzedItems)
  applySelectionPlan(automaticItems, groups, 'balanced', 'general', 'auto')
  if (process.env.LUNA_AI_SELECTION_BENCHMARK_GROUP_DETAILS === '1') {
    const byId = new Map(analyzedItems.map((item) => [item.id, item]))
    console.log(JSON.stringify({ type: 'groups', groups: groups.map((group) => group.itemIds.map((id) => byId.get(id)?.name)) }))
  }
  console.log(JSON.stringify({ type: 'result', ...result, groups: groups.length, groupedItems: new Set(groups.flatMap((group) => group.itemIds)).size, automaticSelected: automaticItems.filter((item) => item.selected).length }))
}

void app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  app.exit(1)
})
