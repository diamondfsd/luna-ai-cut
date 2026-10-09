import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'

import type { LunaEditProject } from '../../../src/shared/types/aiEditing.ts'
import { clipOutputDurationMs, clipSourceOffsetAtOutputMs, orderedTimelineClips } from '../../../src/shared/aiEditingTimeline.ts'
import type { CompositionInput } from '../../platform/render/lunaRenderCore.ts'
import { exportCompositionVideoAsync } from '../../platform/render/lunaRenderCore.ts'
import { getFfmpegPath, getFfprobePath } from '../../platform/ffmpeg/pipeline.ts'
import { getSettings } from '../../storage/fileService.ts'
import { listCustomLutsInDirectory } from '../color/customLutLibrary.ts'
import { loadAiEditorProject } from './aiEditorProjectService.ts'

const execFileAsync = promisify(execFile)

interface ExportAudioTrack {
  path: string
  startMs: number
  durationMs: number
  timelineStartMs: number
  volume: number
}

interface WatermarkAsset {
  id: string
  name: string
  filePath: string
  width: number
  height: number
}

interface PreparedClip {
  path: string
  durationMs: number
  includesAudio: boolean
}

function durationMs(project: LunaEditProject): number {
  return project.clips.reduce((sum, clip) => sum + clipOutputDurationMs(clip), 0)
}

function lutId(relativePath: string): string {
  return `lut:${relativePath.split(path.sep).join('/')}`
}

async function listLuts(): Promise<Array<{ id: string; name: string; path: string }>> {
  const settings = await getSettings()
  const files = await listCustomLutsInDirectory(settings.lutDir || path.join(settings.baseDir, 'luts'))
  return files.map(file => {
    const relativePath = path.join(file.relativeDirectory, file.fileName)
    return { id: lutId(relativePath), name: file.fileName.replace(/\.cube$/i, ''), path: file.filePath }
  })
}

export async function listAiEditorFilters(): Promise<Array<{ id: string; name: string; path: string }>> {
  return listLuts()
}

export async function listAiEditorWatermarks(): Promise<Array<{ id: string; name: string; path: string; width: number; height: number }>> {
  const settings = await getSettings()
  return (settings.customWatermarkAssets ?? []).map(asset => ({ id: asset.id, name: asset.fileName,
    path: asset.filePath, width: asset.width, height: asset.height }))
}

function findLut(id: string, available: Awaited<ReturnType<typeof listLuts>>): string {
  const lut = available.find(item => item.id === id)
  if (!lut) throw new Error('所选滤镜已不存在，请重新选择')
  return lut.path
}

function watermarkRect(project: LunaEditProject, asset: WatermarkAsset): { x: number; y: number; w: number; h: number } {
  const positioning = project.watermark!.positioning
  const width = project.canvas.width * Math.min(0.5, Math.max(0.01, positioning.targetWidth))
  const height = width * asset.height / Math.max(1, asset.width)
  const marginX = Math.max(0, positioning.marginX ?? 0) * project.canvas.width
  const marginY = Math.max(0, positioning.marginY ?? 0) * project.canvas.height
  let x = (project.canvas.width - width) / 2
  let y = project.canvas.height - height - marginY
  if (positioning.centerX !== undefined && positioning.centerY !== undefined) {
    x = positioning.centerX * project.canvas.width - width / 2
    y = positioning.centerY * project.canvas.height - height / 2
  } else {
    if (positioning.anchor.includes('left')) x = marginX
    if (positioning.anchor.includes('right')) x = project.canvas.width - width - marginX
    if (positioning.anchor.startsWith('top')) y = marginY
    if (positioning.anchor === 'center') y = (project.canvas.height - height) / 2
  }
  return { x, y, w: width, h: height }
}

function makeComposition(
  project: LunaEditProject,
  filterPath: string | null,
  watermark: WatermarkAsset | null,
  prepared: Map<string, PreparedClip>,
): CompositionInput {
  const clips = orderedTimelineClips(project.clips)
  let timelineStartMs = 0
  const layers: Array<CompositionInput['layers'][number] & { lutId?: string; lutIntensity?: number; activeStart?: number; activeEnd?: number }> = clips.map((clip, index) => {
    const source = project.sources.find(item => item.id === clip.sourceId)
    if (!source || source.kind === 'audio') throw new Error(`片段来源不存在：${clip.id}`)
    const rendered = prepared.get(clip.id)
    const duration = rendered?.durationMs ?? clipOutputDurationMs(clip)
    const start = timelineStartMs / 1000
    timelineStartMs += duration
    const layer = {
      id: clip.id,
      source: {
        path: rendered?.path ?? source.path,
        sourceType: rendered ? 'video' : source.kind,
        ...(source.kind === 'video' || rendered ? { time: { start: rendered ? 0 : clip.sourceStartMs / 1000,
          duration: duration / 1000, loopEnabled: false } } : {}),
      },
      rect: { x: 0, y: 0, w: project.canvas.width, h: project.canvas.height },
      ...(clip.crop ? { sourceRect: { x: clip.crop.left, y: clip.crop.top, w: clip.crop.width, h: clip.crop.height } } : {}),
      fit: 'cover',
      zIndex: index,
      activeStart: start,
      activeEnd: (timelineStartMs / 1000),
      ...(clip.color ? { color: clip.color } : {}),
      ...(filterPath && project.filter?.enabled !== false ? { lutId: filterPath, lutIntensity: project.filter?.intensity ?? 100 } : {}),
    }
    return layer
  })
  if (watermark && project.watermark) {
    layers.push({
      id: 'project-watermark',
      layerType: 'logo',
      source: { path: watermark.filePath, sourceType: 'image' },
      rect: watermarkRect(project, watermark),
      fit: 'contain',
      opacity: project.watermark.opacity,
      zIndex: layers.length + 1,
      activeStart: 0,
      activeEnd: timelineStartMs / 1000,
    })
  }
  return {
    version: 1,
    canvas: { ...project.canvas, duration: timelineStartMs / 1000 },
    layers,
  } as CompositionInput
}

async function hasAudio(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'json', filePath,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    const value = JSON.parse(stdout) as { streams?: unknown[] }
    return Boolean(value.streams?.length)
  } catch {
    return false
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let output = ''
    const append = (chunk: Buffer | string) => { output = (output + chunk.toString()).slice(-12_000) }
    child.stderr.on('data', append)
    child.stdout.on('data', append)
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(output.trim() || `FFmpeg 执行失败 (${code})`)))
  })
}

interface SpeedSegment {
  sourceStartMs: number
  sourceDurationMs: number
  outputDurationMs: number
  speed: number
}

function speedSegments(clip: LunaEditProject['clips'][number]): SpeedSegment[] {
  const sourceDuration = clip.sourceEndMs - clip.sourceStartMs
  const outputDuration = clipOutputDurationMs(clip)
  if (!clip.speedCurve) return [{ sourceStartMs: 0, sourceDurationMs: sourceDuration, outputDurationMs: outputDuration, speed: sourceDuration / outputDuration }]
  const points = clip.speedCurve.points
  const segments: SpeedSegment[] = []
  let previousOutputMs = 0
  let previousSourceMs = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!
    const b = points[index]!
    const samples = 24
    for (let sample = 1; sample <= samples; sample++) {
      const u = a.u + (b.u - a.u) * sample / samples
      const outputMs = index === points.length - 1 && sample === samples ? outputDuration : Math.round(u * outputDuration)
      const sourceMs = index === points.length - 1 && sample === samples
        ? sourceDuration
        : Math.round(clipSourceOffsetAtOutputMs(clip, outputMs))
      const outputDelta = outputMs - previousOutputMs
      const sourceDelta = sourceMs - previousSourceMs
      if (outputDelta > 0 && sourceDelta > 0) {
        segments.push({ sourceStartMs: previousSourceMs, sourceDurationMs: sourceDelta,
          outputDurationMs: outputDelta, speed: sourceDelta / outputDelta })
        previousOutputMs = outputMs
        previousSourceMs = sourceMs
      }
    }
  }
  if (!segments.length) throw new Error('变速曲线无法生成有效片段')
  return segments
}

function atempoChain(speed: number): string {
  const filters: number[] = []
  let remaining = speed
  while (remaining > 2) { filters.push(2); remaining /= 2 }
  while (remaining < 0.5) { filters.push(0.5); remaining /= 0.5 }
  filters.push(remaining)
  return filters.map(value => `atempo=${value.toFixed(6)}`).join(',')
}

async function prepareVideoClip(project: LunaEditProject, clip: LunaEditProject['clips'][number], sourcePath: string, outputPath: string): Promise<PreparedClip> {
  const segments = speedSegments(clip)
  const sourceDurationMs = clip.sourceEndMs - clip.sourceStartMs
  const outputDuration = clipOutputDurationMs(clip)
  const hasSourceAudio = clip.volume > 0 && await hasAudio(sourcePath)
  const count = segments.length
  const videoInputs = segments.map((_, index) => `[vsrc${index}]`).join('')
  const filters = [count === 1 ? '[0:v:0]null[vsrc0]' : `[0:v:0]split=${count}${videoInputs}`]
  if (hasSourceAudio) filters.push(count === 1 ? '[0:a:0]anull[asrc0]' : `[0:a:0]asplit=${count}${segments.map((_, index) => `[asrc${index}]`).join('')}`)
  segments.forEach((segment, index) => {
    const start = (segment.sourceStartMs / 1000).toFixed(6)
    const duration = (segment.sourceDurationMs / 1000).toFixed(6)
    filters.push(`[vsrc${index}]trim=start=${start}:duration=${duration},setpts=(PTS-STARTPTS)/${segment.speed.toFixed(6)}[v${index}]`)
    if (hasSourceAudio) filters.push(`[asrc${index}]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,${atempoChain(segment.speed)},aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${index}]`)
  })
  if (hasSourceAudio) {
    filters.push(`${segments.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${count}:v=1:a=1[vout][aout]`)
  } else {
    filters.push(`${segments.map((_, index) => `[v${index}]`).join('')}concat=n=${count}:v=1:a=0[vout]`)
  }
  const fadeMs = Math.min(clip.fadeOutMs ?? 0, outputDuration / 2)
  const fadeStart = Math.max(0, (outputDuration - fadeMs) / 1000).toFixed(6)
  if (fadeMs > 0) {
    filters.push(`[vout]fade=t=out:st=${fadeStart}:d=${(fadeMs / 1000).toFixed(6)}:color=black[vfinal]`)
  } else filters.push('[vout]null[vfinal]')
  const args = ['-y', '-ss', (clip.sourceStartMs / 1000).toFixed(6), '-t', (sourceDurationMs / 1000).toFixed(6), '-i', sourcePath,
    '-filter_complex', filters.join(';'), '-map', '[vfinal]', ...(hasSourceAudio ? ['-map', '[aout]'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(project.canvas.fps),
    ...(hasSourceAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-t', (outputDuration / 1000).toFixed(6), '-movflags', '+faststart', outputPath]
  await run(getFfmpegPath(), args)
  return { path: outputPath, durationMs: outputDuration, includesAudio: hasSourceAudio }
}

async function preparePhotoClip(project: LunaEditProject, clip: LunaEditProject['clips'][number], sourcePath: string, outputPath: string): Promise<PreparedClip> {
  const outputDuration = clipOutputDurationMs(clip)
  const fps = project.canvas.fps
  const width = project.canvas.width
  const height = project.canvas.height
  const frameCount = Math.max(1, Math.round(outputDuration * fps / 1000))
  const filters = [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`]
  if (clip.photoMotion === 'gentleZoomIn') {
    filters.push(`zoompan=z='min(1+0.08*on/${Math.max(1, frameCount - 1)},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`)
  } else filters.push(`fps=${fps}`)
  const fadeMs = Math.min(clip.fadeOutMs ?? 0, outputDuration / 2)
  if (fadeMs > 0) filters.push(`fade=t=out:st=${Math.max(0, (outputDuration - fadeMs) / 1000).toFixed(6)}:d=${(fadeMs / 1000).toFixed(6)}:color=black`)
  filters.push('format=yuv420p')
  await run(getFfmpegPath(), ['-y', '-loop', '1', '-framerate', String(fps), '-i', sourcePath, '-vf', filters.join(','),
    '-t', (outputDuration / 1000).toFixed(6), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath])
  return { path: outputPath, durationMs: outputDuration, includesAudio: false }
}

async function mixAudio(silentVideo: string, targetPath: string, audioTracks: ExportAudioTrack[], totalMs: number): Promise<void> {
  const tracks: Array<ExportAudioTrack & { input: number }> = []
  const inputs = [silentVideo]
  for (const track of audioTracks) {
    if (track.volume <= 0 || !(await hasAudio(track.path))) continue
    inputs.push(track.path)
    tracks.push({ ...track, input: inputs.length - 1 })
  }
  if (!tracks.length) {
    await fs.rename(silentVideo, targetPath)
    return
  }
  const totalSec = (totalMs / 1000).toFixed(3)
  const filters = tracks.map((track, index) => {
    const delay = Math.max(0, Math.round(track.timelineStartMs))
    const label = `a${index}`
    return `[${track.input}:a:0]atrim=start=${(track.startMs / 1000).toFixed(3)}:duration=${(track.durationMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,volume=${track.volume.toFixed(4)},adelay=${delay}:all=1,apad,atrim=duration=${totalSec}[${label}]`
  })
  const labels = tracks.map((_, index) => `[a${index}]`).join('')
  filters.push(`${labels}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98,aresample=48000[aout]`)
  await run(getFfmpegPath(), [
    '-y', ...inputs.flatMap(file => ['-i', file]),
    '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', totalSec, '-movflags', '+faststart', targetPath,
  ])
}

async function replaceOutput(stagedFile: string, outputPath: string): Promise<void> {
  const backup = `${outputPath}.luna-backup-${process.pid}-${Date.now()}`
  const existing = await fs.lstat(outputPath).catch(() => null)
  if (!existing) {
    await fs.rename(stagedFile, outputPath)
    return
  }
  await fs.rename(outputPath, backup)
  try {
    await fs.rename(stagedFile, outputPath)
    await fs.rm(backup, { force: true })
  } catch (error) {
    await fs.rename(backup, outputPath).catch(() => undefined)
    throw error
  }
}

export async function exportAiEditorProject(baseDir: string, projectId: string, outputPath: string): Promise<string> {
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.mp4') throw new Error('导出位置无效')
  const { project } = await loadAiEditorProject(baseDir, projectId)
  if (!project.clips.length) throw new Error('时间线没有可导出的片段')
  const output = path.resolve(outputPath)
  const sourcePaths = project.sources.map(source => path.resolve(source.path))
  if (sourcePaths.includes(output)) throw new Error('不能覆盖工程原素材')
  const [outputRealPath, sourceRealPaths] = await Promise.all([
    fs.realpath(output).catch(() => null), Promise.all(sourcePaths.map(file => fs.realpath(file).catch(() => null))),
  ])
  if (outputRealPath && sourceRealPaths.some(sourcePath => sourcePath === outputRealPath)) throw new Error('不能覆盖工程原素材')
  const outputDirectory = path.dirname(output)
  await fs.mkdir(outputDirectory, { recursive: true })
  const settings = await getSettings()
  const availableLuts = await listLuts()
  const filterPath = project.filter?.enabled ? findLut(project.filter.id, availableLuts) : null
  const watermark = project.watermark
    ? (() => {
        const asset = (settings.customWatermarkAssets ?? []).find(item => item.id === project.watermark!.id)
        return asset ? { id: asset.id, name: asset.fileName, filePath: asset.filePath, width: asset.width, height: asset.height } : null
      })()
    : null
  if (project.watermark && !watermark) throw new Error('所选水印已不存在，请重新选择')
  const temporaryDirectory = await fs.mkdtemp(path.join(outputDirectory, '.luna-ai-editor-'))
  const silentVideo = path.join(temporaryDirectory, 'render.mp4')
  const mixedVideo = path.join(temporaryDirectory, 'mixed.mp4')
  try {
    const prepared = new Map<string, PreparedClip>()
    for (const clip of orderedTimelineClips(project.clips)) {
      const source = project.sources.find(item => item.id === clip.sourceId)
      if (!source || source.kind === 'audio') throw new Error(`片段来源不存在：${clip.id}`)
      const needsPreparation = source.kind === 'video'
        ? Boolean(clip.speedCurve || clip.fadeOutMs)
        : clip.photoMotion === 'gentleZoomIn' || Boolean(clip.fadeOutMs)
      if (!needsPreparation) continue
      const destination = path.join(temporaryDirectory, `${clip.id}.mp4`)
      const rendered = source.kind === 'video'
        ? await prepareVideoClip(project, clip, source.path, destination)
        : await preparePhotoClip(project, clip, source.path, destination)
      prepared.set(clip.id, rendered)
    }
    const composition = makeComposition(project, filterPath, watermark, prepared)
    await exportCompositionVideoAsync({
      ffmpegPath: getFfmpegPath(), ffprobePath: getFfprobePath(), outputPath: silentVideo,
      composition, fps: project.canvas.fps, duration: composition.canvas.duration, hardware: true,
      qualityPreset: 'high', includeAudio: false,
    })
    const clips = orderedTimelineClips(project.clips)
    const audioTracks: ExportAudioTrack[] = []
    for (const clip of clips) {
      const source = project.sources.find(item => item.id === clip.sourceId)
      if (source?.kind === 'video') {
        const rendered = prepared.get(clip.id)
        audioTracks.push({ path: rendered?.path ?? source.path, startMs: rendered ? 0 : clip.sourceStartMs,
          durationMs: rendered?.durationMs ?? (clip.sourceEndMs - clip.sourceStartMs), timelineStartMs: clip.timelineStartMs, volume: clip.volume })
      }
    }
    if (project.music && project.musicEnabled !== false) {
      const source = project.sources.find(item => item.id === project.music!.sourceId)
      if (source?.kind === 'audio') audioTracks.push({ path: source.path, startMs: project.music.sourceStartMs,
        durationMs: Math.min(project.music.sourceEndMs - project.music.sourceStartMs, durationMs(project)), timelineStartMs: 0,
        volume: project.music.volume })
    }
    await mixAudio(silentVideo, mixedVideo, audioTracks, durationMs(project))
    await replaceOutput(mixedVideo, output)
    return output
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
