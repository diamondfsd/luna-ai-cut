import { spawn } from 'node:child_process'
import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import type { WebContents } from 'electron'

import { runExportJob, type ExportJobItem } from './exportJobService'
import { safeName } from './filePathUtils'
import { getFfmpegPath, probeMedia } from './ffmpeg/pipeline'
import { bakeColorLut } from './ffmpeg/lutGenerator'
import { combineLivePhoto, extractLivePhotoVideo, watermarkFileFor } from './watermarkService'

export interface TripleStitchExportSlot {
  name: string
  path: string
  kind: 'image' | 'video'
  isLivePhoto?: boolean
  transform: {
    scale: number
    offsetX: number
    offsetY: number
  }
  liveStart?: number
  pipeline?: Record<string, any>
}

export interface TripleStitchExportOptions {
  name: string
  slots: TripleStitchExportSlot[]
  watermarkEnabled: boolean
  outputs: {
    liveImage: boolean
    video: boolean
    appleLivePhoto: boolean
  }
  videoDuration: number
  videoQuality: 'high' | 'medium' | 'low'
  watermarkStyle?: string
}

interface PreparedSlot extends TripleStitchExportSlot {
  sourcePath: string
  inputKind: 'image' | 'video'
  durationSeconds: number | null
  lutPath?: string
}

interface RenderProfile {
  width: number
  height: number
  bitrateKbps: number
}

function renderProfileFor(quality: TripleStitchExportOptions['videoQuality']): RenderProfile {
  if (quality === 'low') return { width: 1080, height: 1920, bitrateKbps: 20000 }
  if (quality === 'medium') return { width: 1440, height: 2560, bitrateKbps: 30000 }
  return { width: 2160, height: 3840, bitrateKbps: 50000 }
}

function hasColorPipeline(pipeline?: Record<string, any>): boolean {
  const color = pipeline?.color
  if (!color || typeof color !== 'object') return false
  return Object.entries(color as Record<string, any>).some(([key, value]) => {
    if (key === 'levelsWhite') return typeof value === 'number' && value !== 1
    if (key === 'levelsGray') return typeof value === 'number' && value !== 0.5
    if (typeof value === 'number') return value !== 0
    return key === 'curve' && Array.isArray(value?.points?.rgb) && value.points.rgb.length > 0
  })
}

function ffmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "\\'")
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args)
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || '三拼导出失败'))
    })
  })
}

async function prepareSlots(slots: TripleStitchExportSlot[], tmpDir: string): Promise<PreparedSlot[]> {
  const prepared = await Promise.all(slots.map(async (slot, index) => {
    if (slot.isLivePhoto) {
      const extracted = path.join(tmpDir, `slot_${index}_live.mp4`)
      const result = await extractLivePhotoVideo(slot.path, extracted)
      if (result) {
        const probe = await probeMedia(result).catch(() => null)
        return { ...slot, sourcePath: result, inputKind: 'video' as const, durationSeconds: probe?.durationSeconds ?? null }
      }
    }
    if (slot.kind === 'video') {
      const probe = await probeMedia(slot.path).catch(() => null)
      return { ...slot, sourcePath: slot.path, inputKind: 'video' as const, durationSeconds: probe?.durationSeconds ?? null }
    }
    return { ...slot, sourcePath: slot.path, inputKind: 'image' as const, durationSeconds: null }
  }))
  return Promise.all(prepared.map(async (slot, index) => {
    const normalized = slot.durationSeconds
      ? { ...slot, liveStart: Math.min(Math.max(0, slot.liveStart ?? 0), Math.max(0, slot.durationSeconds - 3)) }
      : slot
    if (!hasColorPipeline(normalized.pipeline)) return normalized
    const lutPath = path.join(tmpDir, `slot_${index}_color.cube`)
    await bakeColorLut(normalized.pipeline?.color ?? {}, lutPath)
    return { ...normalized, lutPath }
  }))
}

function capVideoDuration(requested: number, slots: PreparedSlot[]): number {
  const durations = slots
    .map((slot) => slot.durationSeconds == null ? null : slot.durationSeconds - Math.max(0, slot.liveStart ?? 0))
    .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration > 0)
  if (durations.length === 0) return requested
  return Math.max(1, Math.min(requested, Math.max(...durations)))
}

function buildInputArgs(slots: PreparedSlot[], duration: number, useLiveRange: boolean): string[] {
  return slots.flatMap((slot) => {
    if (slot.inputKind === 'image') return ['-loop', '1', '-t', String(duration), '-i', slot.sourcePath]
    const seek = useLiveRange ? Math.max(0, slot.liveStart ?? 0) : 0
    return seek > 0
      ? ['-stream_loop', '-1', '-ss', String(seek), '-i', slot.sourcePath]
      : ['-stream_loop', '-1', '-i', slot.sourcePath]
  })
}

function buildFilter(slots: PreparedSlot[], watermarkEnabled: boolean, watermarkInputIndex: number | null, profile: RenderProfile): string {
  const outW = profile.width
  const outH = profile.height
  const slotH = outH / 3
  const slotFilters = slots.map((slot, index) => {
    const scale = Math.max(1, slot.transform.scale || 1)
    const offsetX = Math.round((slot.transform.offsetX || 0) * (outW / 1080))
    const offsetY = Math.round((slot.transform.offsetY || 0) * (slotH / 640))
    const scaledW = Math.round(outW * scale)
    const scaledH = Math.round(slotH * scale)
    const cropX = `min(max((iw-${outW})/2-${offsetX}\\,0)\\,iw-${outW})`
    const cropY = `min(max((ih-${slotH})/2-${offsetY}\\,0)\\,ih-${slotH})`
    const color = slot.lutPath ? `lut3d=file='${ffmpegFilterPath(slot.lutPath)}':interp=tetrahedral,` : ''
    return `[${index}:v]setpts=PTS-STARTPTS,${color}scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${outW}:${slotH}:${cropX}:${cropY},setsar=1,format=yuv420p[s${index}]`
  })
  const stack = `[s0][s1][s2]vstack=inputs=3[stack]`
  if (!watermarkEnabled || watermarkInputIndex == null) return [...slotFilters, stack, '[stack]format=yuv420p[outv]'].join(';')

  const wmWidth = Math.round(outW * 0.3)
  const bottomPadding = Math.max(34, Math.round(slotH * 0.075))
  const wm = `[${watermarkInputIndex}:v]format=rgba,scale=${wmWidth}:-1,split=3[wm0][wm1][wm2]`
  const overlay0 = `[stack][wm0]overlay=(W-w)/2:${slotH}-h-${bottomPadding}:format=auto[o0]`
  const overlay1 = `[o0][wm1]overlay=(W-w)/2:${slotH * 2}-h-${bottomPadding}:format=auto[o1]`
  const overlay2 = `[o1][wm2]overlay=(W-w)/2:${slotH * 3}-h-${bottomPadding}:format=auto,format=yuv420p[outv]`
  return [...slotFilters, stack, wm, overlay0, overlay1, overlay2].join(';')
}

async function renderTripleVideo(
  slots: PreparedSlot[],
  outputPath: string,
  duration: number,
  watermarkEnabled: boolean,
  profile: RenderProfile,
  watermarkStyle: string,
  useLiveRange = false,
): Promise<void> {
  const watermarkPath = watermarkFileFor('image', watermarkStyle)
  const inputArgs = buildInputArgs(slots, duration, useLiveRange)
  const watermarkArgs = watermarkEnabled ? ['-i', watermarkPath] : []
  const watermarkIndex = watermarkEnabled ? slots.length : null
  const bitrate = `${profile.bitrateKbps}k`
  const maxrate = `${Math.round(profile.bitrateKbps * 1.2)}k`
  const bufsize = `${Math.round(profile.bitrateKbps * 2)}k`
  await runFfmpeg([
    '-y',
    ...inputArgs,
    ...watermarkArgs,
    '-filter_complex', buildFilter(slots, watermarkEnabled, watermarkIndex, profile),
    '-map', '[outv]',
    '-t', String(duration),
    '-r', '30',
    ...(process.platform === 'darwin'
      ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize]),
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    outputPath,
  ])
}

async function renderTripleImage(
  slots: PreparedSlot[],
  outputPath: string,
  watermarkEnabled: boolean,
  profile: RenderProfile,
  watermarkStyle: string,
  useLiveRange = false,
): Promise<void> {
  const watermarkPath = watermarkFileFor('image', watermarkStyle)
  const inputArgs = buildInputArgs(slots, 1, useLiveRange)
  const watermarkArgs = watermarkEnabled ? ['-i', watermarkPath] : []
  const watermarkIndex = watermarkEnabled ? slots.length : null
  await runFfmpeg([
    '-y',
    ...inputArgs,
    ...watermarkArgs,
    '-filter_complex', buildFilter(slots, watermarkEnabled, watermarkIndex, profile),
    '-map', '[outv]',
    '-frames:v', '1',
    '-q:v', '2',
    outputPath,
  ])
}

export async function exportTripleStitch(
  exportDir: string,
  options: TripleStitchExportOptions,
  sender?: WebContents,
): Promise<Array<{ path: string; name: string }>> {
  await mkdir(exportDir, { recursive: true })
  const baseName = safeName(options.name || `triple_stitch_${Date.now()}`)
  const tmpDir = path.join(exportDir, `.triple_stitch_${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })

  const items: Array<ExportJobItem<'live' | 'video' | 'apple'>> = []
  if (options.outputs.liveImage) items.push({ exportId: `${baseName}_live_${Date.now()}`, fileName: `${baseName}_live.jpg`, kind: 'image', type: 'live' })
  if (options.outputs.video) items.push({ exportId: `${baseName}_video_${Date.now()}`, fileName: `${baseName}.mp4`, kind: 'video', type: 'video' })
  if (options.outputs.appleLivePhoto) items.push({ exportId: `${baseName}_apple_${Date.now()}`, fileName: `${baseName}_apple.jpg`, kind: 'image', type: 'apple' })
  const completed: Array<{ path: string; name: string }> = []

  try {
    await runExportJob('三拼创意导出', items, sender, async ({ updateItem }) => {
      const slots = await prepareSlots(options.slots, tmpDir)
      const profile = renderProfileFor(options.videoQuality ?? 'high')
      const watermarkStyle = options.watermarkStyle ?? 'luna_ultra_cn'
      const effectiveVideoDuration = capVideoDuration(options.videoDuration, slots)
      const stillPath = path.join(tmpDir, `${baseName}_still.jpg`)
      const liveVideoPath = path.join(tmpDir, `${baseName}_live.mp4`)

      if (options.outputs.liveImage || options.outputs.appleLivePhoto) {
        await renderTripleImage(slots, stillPath, options.watermarkEnabled, profile, watermarkStyle, true)
        await renderTripleVideo(slots, liveVideoPath, 3, options.watermarkEnabled, profile, watermarkStyle, true)
      }

      for (const item of items) {
        await updateItem(item, 10, 'exporting')
        try {
          if (item.type === 'video') {
            const outputPath = path.join(exportDir, `${baseName}_${Date.now()}.mp4`)
            await renderTripleVideo(slots, outputPath, effectiveVideoDuration, options.watermarkEnabled, profile, watermarkStyle, true)
            completed.push({ path: outputPath, name: path.basename(outputPath) })
            await updateItem(item, 100, 'done', { destinationPath: outputPath })
          } else {
            const outputPath = path.join(exportDir, `${baseName}_${item.type}_${Date.now()}.jpg`)
            const appleFolder = item.type === 'apple' ? path.join(tmpDir, `${baseName}_apple_pair`) : undefined
            await combineLivePhoto(stillPath, liveVideoPath, outputPath, appleFolder)
            completed.push({ path: outputPath, name: path.basename(outputPath) })
            await updateItem(item, 100, 'done', { destinationPath: outputPath })
          }
        } catch (error) {
          await updateItem(item, 0, 'failed', { error: error instanceof Error ? error.message : String(error) })
          throw error
        }
      }
    })
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }

  return completed
}
