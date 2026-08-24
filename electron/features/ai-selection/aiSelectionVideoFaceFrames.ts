import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AiFaceDescriptor, AiFaceGroup, AiSelectionItem } from '../../../src/shared/types'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'

function matchingFace(item: AiSelectionItem, bounds: AiFaceGroup['coverBounds']): AiFaceDescriptor | undefined {
  return item.personEvidence?.faces?.find((face) => (
    Math.abs(face.bounds.x - bounds.x) < 0.0001
    && Math.abs(face.bounds.y - bounds.y) < 0.0001
  ))
}

function framePath(cacheRoot: string, itemId: string, frameTime: number): string {
  const key = createHash('sha256').update(itemId).digest('hex').slice(0, 24)
  return path.join(cacheRoot, 'video-face-frames', key, `${frameTime.toFixed(3)}.jpg`)
}

async function createFrame(item: AiSelectionItem, frameTime: number, outputPath: string, signal?: AbortSignal): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const exists = await fs.stat(outputPath).then(() => true).catch(() => false)
  if (exists) return
  await new Promise<void>((resolve, reject) => {
    execFile(getFfmpegPath(), [
      '-y', '-v', 'error', '-ss', frameTime.toFixed(3), '-i', item.path,
      '-frames:v', '1', '-vf', 'scale=640:-2:flags=bilinear', '-q:v', '5', outputPath,
    ], { signal }, (error) => error ? reject(error) : resolve())
  })
}

export async function ensureVideoFaceFrames(
  item: AiSelectionItem,
  cacheRoot: string,
  requestedTimes?: Iterable<number>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (item.kind !== 'video') return false
  const byTime = new Map<number, AiFaceDescriptor[]>()
  const requested = requestedTimes ? new Set(requestedTimes) : null
  for (const face of item.personEvidence?.faces ?? []) {
    const frameTime = face.frameTime
    if (!face.embedding || typeof frameTime !== 'number' || !Number.isFinite(frameTime) || (requested && !requested.has(frameTime))) continue
    const faces = byTime.get(frameTime) ?? []
    faces.push(face)
    byTime.set(frameTime, faces)
  }
  let changed = false
  for (const [frameTime, faces] of byTime) {
    signal?.throwIfAborted()
    let url = faces.find((face) => face.frameThumbnailUrl)?.frameThumbnailUrl
    if (!url) {
      try {
        const outputPath = framePath(cacheRoot, item.id, frameTime)
        await createFrame(item, frameTime, outputPath, signal)
        url = pathToFileURL(outputPath).toString()
      } catch (error) {
        if (signal?.aborted) throw error
        continue
      }
    }
    for (const face of faces) {
      if (face.frameThumbnailUrl === url) continue
      face.frameThumbnailUrl = url
      changed = true
    }
  }
  return changed
}

export async function ensureVideoFaceGroupCoverFrames(
  items: AiSelectionItem[],
  groups: AiFaceGroup[],
  cacheRoot: string,
): Promise<boolean> {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const requested = new Map<string, Set<number>>()
  for (const group of groups) {
    const item = itemsById.get(group.coverItemId)
    const coverFace = group.memberFaces.find((face) => face.itemId === group.coverItemId)
    const face = item && coverFace ? matchingFace(item, coverFace.bounds) : undefined
    const frameTime = face?.frameTime
    if (!item || item.kind !== 'video' || !face || typeof frameTime !== 'number' || !Number.isFinite(frameTime) || face.frameThumbnailUrl) continue
    const times = requested.get(item.id) ?? new Set<number>()
    times.add(frameTime)
    requested.set(item.id, times)
  }
  let changed = false
  for (const [itemId, times] of requested) {
    const item = itemsById.get(itemId)
    if (item && await ensureVideoFaceFrames(item, cacheRoot, times)) changed = true
  }
  return changed
}
