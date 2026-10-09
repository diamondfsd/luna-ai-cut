import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { EditProjectSource, EditProjectSummary, LunaEditProject } from '../../../src/shared/types/aiEditing.ts'
import { getAiEditorLocalMedia } from './aiEditorLocalMediaService.ts'
import { getAiEditorLocalMediaMetadata } from './aiEditorMediaMetadataService.ts'

export const AI_EDITOR_PROJECTS_DIR = 'ai-editor-projects'
const PROJECT_FILE = 'project.json'
const projectOperations = new Map<string, Promise<void>>()

function projectRoot(baseDir: string): string {
  return path.resolve(baseDir, AI_EDITOR_PROJECTS_DIR)
}

function projectDirectory(baseDir: string, id: string): string {
  if (!/^[\w.-]{1,100}$/.test(id) || id === '.' || id === '..') throw new Error('项目编号无效')
  const root = projectRoot(baseDir)
  const directory = path.resolve(root, id)
  const relative = path.relative(root, directory)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('项目目录无效')
  return directory
}

function projectPath(baseDir: string, id: string): string {
  return path.join(projectDirectory(baseDir, id), PROJECT_FILE)
}

function makeProject(name: string): LunaEditProject {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    name: name.trim() || '未命名剪辑',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    directorPlanId: null,
    canvas: { width: 1080, height: 1920, fps: 30 },
    sources: [],
    clips: [],
    music: null,
    musicEnabled: true,
    filter: null,
    watermark: null,
  }
}

function validProject(value: unknown): value is LunaEditProject {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<LunaEditProject>
  return project.schemaVersion === 1 && typeof project.id === 'string' && typeof project.name === 'string'
    && typeof project.createdAt === 'string' && typeof project.updatedAt === 'string'
    && Number.isInteger(project.revision) && Boolean(project.canvas && project.sources && project.clips)
    && Array.isArray(project.sources) && Array.isArray(project.clips)
}

async function readProject(filePath: string): Promise<LunaEditProject | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
    return validProject(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function resolveTrustedSources(project: LunaEditProject): Promise<LunaEditProject> {
  const sources = await Promise.all(project.sources.map(async (source) => {
    if (typeof source.mediaId !== 'string' || !source.mediaId) throw new Error(`素材来源无效：${source.name}`)
    const media = await getAiEditorLocalMedia(source.mediaId)
    if (media.kind !== source.kind || path.resolve(media.filePath) !== path.resolve(source.path)) {
      throw new Error(`素材来源已变化，请重新加入工程：${source.name}`)
    }
    return { ...source, path: path.resolve(media.filePath), name: media.name }
  }))
  return { ...project, sources }
}

async function writeProjectAt(baseDir: string, project: LunaEditProject): Promise<void> {
  const directory = projectDirectory(baseDir, project.id)
  await fs.mkdir(directory, { recursive: true })
  const destination = path.join(directory, PROJECT_FILE)
  const temporary = path.join(directory, `.${PROJECT_FILE}.${process.pid}.${randomUUID()}.tmp`)
  const serialized = `${JSON.stringify(project, null, 2)}\n`
  try {
    await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function withProjectOperation<T>(baseDir: string, projectId: string, operation: () => Promise<T>): Promise<T> {
  const key = projectPath(baseDir, projectId)
  const previous = projectOperations.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  projectOperations.set(key, tail)
  try {
    return await result
  } finally {
    if (projectOperations.get(key) === tail) projectOperations.delete(key)
  }
}

function summary(project: LunaEditProject): EditProjectSummary {
  return { projectId: project.id, projectName: project.name, createdAt: project.createdAt,
    updatedAt: project.updatedAt, revision: project.revision, clipCount: project.clips.length }
}

function validateProjectUpdate(incoming: LunaEditProject, saved: LunaEditProject): LunaEditProject {
  if (!validProject(incoming) || incoming.id !== saved.id || incoming.schemaVersion !== 1) throw new Error('剪辑工程格式无效')
  if (!Number.isInteger(incoming.canvas.width) || incoming.canvas.width < 16 || incoming.canvas.width > 7680
    || !Number.isInteger(incoming.canvas.height) || incoming.canvas.height < 16 || incoming.canvas.height > 7680
    || !Number.isFinite(incoming.canvas.fps) || incoming.canvas.fps < 1 || incoming.canvas.fps > 120) {
    throw new Error('画布参数无效')
  }
  const savedSources = new Map(saved.sources.map(source => [source.id, source]))
  const sources = incoming.sources.map(source => {
    const trusted = savedSources.get(source.id)
    if (!trusted) throw new Error('工程来源发生变化，请重新读取工程')
    return trusted
  })
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('素材来源重复')
  const sourceIds = new Set(sources.map(source => source.id))
  const clips = incoming.clips.map(clip => {
    const source = savedSources.get(clip.sourceId)
    if (!source || !sourceIds.has(clip.sourceId) || source.kind === 'audio'
      || !Number.isFinite(clip.sourceStartMs) || !Number.isFinite(clip.sourceEndMs)
      || clip.sourceStartMs < 0 || clip.sourceEndMs <= clip.sourceStartMs
      || (source.durationMs !== null && clip.sourceEndMs > source.durationMs)
      || !Number.isFinite(clip.timelineStartMs) || clip.timelineStartMs < 0
      || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 1
      || typeof clip.id !== 'string' || !clip.id.trim()) throw new Error(`时间线片段无效：${clip.id}`)
    if (clip.crop && (!Number.isFinite(clip.crop.left) || !Number.isFinite(clip.crop.top)
      || !Number.isFinite(clip.crop.width) || !Number.isFinite(clip.crop.height)
      || clip.crop.left < 0 || clip.crop.top < 0 || clip.crop.width <= 0 || clip.crop.height <= 0
      || clip.crop.left + clip.crop.width > 1 || clip.crop.top + clip.crop.height > 1)) throw new Error(`片段裁切参数无效：${clip.id}`)
    if (clip.photoMotion !== undefined && clip.photoMotion !== 'none' && clip.photoMotion !== 'gentleZoomIn') throw new Error(`照片运镜无效：${clip.id}`)
    if (clip.fadeOutMs !== undefined && (!Number.isInteger(clip.fadeOutMs) || clip.fadeOutMs < 0)) throw new Error(`片尾淡出无效：${clip.id}`)
    if (clip.speedCurve) {
      const { interpolation, points } = clip.speedCurve
      if (source.kind !== 'video' || (interpolation !== 'linear' && interpolation !== 'smooth') || !Array.isArray(points)
        || points.length < 2 || points.length > 9 || points[0]?.u !== 0 || points[points.length - 1]?.u !== 1
        || points.some((point, index) => !Number.isFinite(point.u) || !Number.isFinite(point.speed)
          || point.u < 0 || point.u > 1 || point.speed < 0.25 || point.speed > 4
          || (index > 0 && point.u <= points[index - 1]!.u))) throw new Error(`变速曲线无效：${clip.id}`)
    }
    if (clip.color && Object.values(clip.color).some(value => typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error(`片段调色参数无效：${clip.id}`)
    }
    return { ...clip }
  })
  if (new Set(clips.map(clip => clip.id)).size !== clips.length) throw new Error('时间线片段编号重复')
  if (incoming.music && (!sourceIds.has(incoming.music.sourceId)
    || sources.find(source => source.id === incoming.music!.sourceId)?.kind !== 'audio'
    || !Number.isFinite(incoming.music.sourceStartMs) || !Number.isFinite(incoming.music.sourceEndMs)
    || !Number.isFinite(incoming.music.volume) || incoming.music.sourceStartMs < 0 || incoming.music.sourceEndMs <= incoming.music.sourceStartMs
    || (sources.find(source => source.id === incoming.music!.sourceId)?.durationMs !== null
      && incoming.music.sourceEndMs > (sources.find(source => source.id === incoming.music!.sourceId)?.durationMs ?? 0))
    || incoming.music.volume < 0 || incoming.music.volume > 1)) throw new Error('配乐轨道无效')
  if (incoming.music?.timing && (!Number.isFinite(incoming.music.timing.bpm) || incoming.music.timing.bpm <= 0
    || !Number.isFinite(incoming.music.timing.duration) || incoming.music.timing.duration <= 0
    || !Array.isArray(incoming.music.timing.beatTimes) || incoming.music.timing.beatTimes.some(value => !Number.isFinite(value))
    || !Array.isArray(incoming.music.timing.downbeats) || incoming.music.timing.downbeats.some(value => !Number.isFinite(value))
    || !Array.isArray(incoming.music.timing.percussionHits) || incoming.music.timing.percussionHits.some(hit =>
      !Number.isFinite(hit.time) || !Number.isFinite(hit.pitch) || !Number.isFinite(hit.velocity)))) throw new Error('配乐节奏数据无效')
  if (incoming.musicEnabled !== undefined && typeof incoming.musicEnabled !== 'boolean') throw new Error('配乐开关无效')
  if (incoming.filter !== null && incoming.filter !== undefined
    && (typeof incoming.filter.id !== 'string' || !incoming.filter.id
      || !Number.isFinite(incoming.filter.intensity) || incoming.filter.intensity < 0 || incoming.filter.intensity > 100
      || typeof incoming.filter.enabled !== 'boolean')) throw new Error('滤镜设置无效')
  if (incoming.watermark !== null && incoming.watermark !== undefined
    && (typeof incoming.watermark.id !== 'string' || !incoming.watermark.id
      || !Number.isFinite(incoming.watermark.width) || incoming.watermark.width <= 0 || incoming.watermark.width > 0.5
      || !Number.isFinite(incoming.watermark.opacity) || incoming.watermark.opacity < 0 || incoming.watermark.opacity > 1
      || !incoming.watermark.positioning || !Number.isFinite(incoming.watermark.positioning.targetWidth)
      || !Number.isFinite(incoming.watermark.positioning.marginX ?? 0) || !Number.isFinite(incoming.watermark.positioning.marginY ?? 0)
      || !['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center'].includes(incoming.watermark.positioning.anchor)
      || (incoming.watermark.positioning.centerX !== undefined && (!Number.isFinite(incoming.watermark.positioning.centerX) || incoming.watermark.positioning.centerX < 0 || incoming.watermark.positioning.centerX > 1))
      || (incoming.watermark.positioning.centerY !== undefined && (!Number.isFinite(incoming.watermark.positioning.centerY) || incoming.watermark.positioning.centerY < 0 || incoming.watermark.positioning.centerY > 1)))) {
    throw new Error('水印设置无效')
  }
  return { ...saved, name: incoming.name.trim() || saved.name, directorPlanId: incoming.directorPlanId,
    canvas: { ...incoming.canvas }, sources, clips, music: incoming.music ? { ...incoming.music } : null,
    musicEnabled: incoming.musicEnabled !== false,
    filter: incoming.filter ? { ...incoming.filter } : null,
    watermark: incoming.watermark ? { ...incoming.watermark, positioning: { ...incoming.watermark.positioning } } : null }
}

function historySnapshot(project: LunaEditProject): Omit<LunaEditProject, 'aiUndo'> {
  const { aiUndo: _discarded, ...state } = project
  return JSON.parse(JSON.stringify(state)) as Omit<LunaEditProject, 'aiUndo'>
}

function withTaskUndo(
  previous: LunaEditProject,
  next: LunaEditProject,
  taskId: string | undefined,
): LunaEditProject {
  if (!taskId?.trim()) return { ...next, aiUndo: [] }
  const history = [...previous.aiUndo ?? []]
  const last = history[history.length - 1]
  if (last?.taskId === taskId) history[history.length - 1] = { ...last, afterRevision: next.revision }
  else history.push({ taskId, before: historySnapshot(previous), afterRevision: next.revision })
  return { ...next, aiUndo: history.slice(-20) }
}

export async function listAiEditorProjects(baseDir: string): Promise<EditProjectSummary[]> {
  try {
    const entries = await fs.readdir(projectRoot(baseDir), { withFileTypes: true })
    const projects = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => readProject(projectPath(baseDir, entry.name))))
    return projects.filter((project): project is LunaEditProject => Boolean(project))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(summary)
  } catch {
    return []
  }
}

export async function createAiEditorProject(baseDir: string, name: string): Promise<EditProjectSummary> {
  const project = makeProject(name)
  await writeProjectAt(baseDir, project)
  return summary(project)
}

export async function loadAiEditorProject(baseDir: string, projectId: string): Promise<{ project: LunaEditProject }> {
  const rawProject = await readProject(projectPath(baseDir, projectId))
  if (!rawProject || rawProject.id !== projectId) throw new Error('剪辑工程不存在')
  const project = await resolveTrustedSources(rawProject)
  return { project }
}

export async function saveAiEditorProject(baseDir: string, incoming: LunaEditProject, expectedRevision: number, taskId?: string): Promise<LunaEditProject> {
  return withProjectOperation(baseDir, incoming.id, async () => {
    const rawSaved = await readProject(projectPath(baseDir, incoming.id))
    if (!rawSaved) throw new Error('剪辑工程不存在')
    const saved = await resolveTrustedSources(rawSaved)
    if (saved.revision !== expectedRevision) throw new Error('工程版本已变化，请重新读取后再修改')
    const project = validateProjectUpdate(incoming, saved)
    project.revision = saved.revision + 1
    project.updatedAt = new Date().toISOString()
    const withUndo = withTaskUndo(saved, project, taskId)
    await writeProjectAt(baseDir, withUndo)
    return withUndo
  })
}

export async function addAiEditorProjectMedia(baseDir: string, projectId: string, mediaIds: string[]): Promise<LunaEditProject> {
  return withProjectOperation(baseDir, projectId, async () => {
    const rawProject = await readProject(projectPath(baseDir, projectId))
    if (!rawProject) throw new Error('剪辑工程不存在')
    const project = await resolveTrustedSources(rawProject)
    const uniqueIds = [...new Set(mediaIds)].filter(Boolean)
    const existingMediaIds = new Set(project.sources.map(source => source.mediaId).filter((id): id is string => Boolean(id)))
    const additions = await Promise.all(uniqueIds.filter(id => !existingMediaIds.has(id)).map(async mediaId => {
      const media = await getAiEditorLocalMedia(mediaId)
      const [metadata] = await getAiEditorLocalMediaMetadata([mediaId])
      return {
        id: randomUUID(), mediaId, name: media.name, kind: media.kind,
        path: path.resolve(media.filePath),
        durationMs: metadata?.durationSec === null || metadata?.durationSec === undefined ? null : Math.round(metadata.durationSec * 1000),
        width: metadata?.width ?? null, height: metadata?.height ?? null,
      } satisfies EditProjectSource
    }))
    const next = { ...project, sources: [...project.sources, ...additions], revision: project.revision + 1, updatedAt: new Date().toISOString(), aiUndo: [] }
    await writeProjectAt(baseDir, next)
    return next
  })
}

export async function setAiEditorProjectMusic(
  baseDir: string,
  projectId: string,
  expectedRevision: number,
  mediaId: string,
  volume = 0.75,
  taskId?: string,
  timing?: NonNullable<LunaEditProject['music']>['timing'],
): Promise<LunaEditProject> {
  return withProjectOperation(baseDir, projectId, async () => {
    const rawProject = await readProject(projectPath(baseDir, projectId))
    if (!rawProject) throw new Error('剪辑工程不存在')
    const project = await resolveTrustedSources(rawProject)
    if (project.revision !== expectedRevision) throw new Error('工程版本已变化，请重新读取后再修改')
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('配乐音量无效')
    const media = await getAiEditorLocalMedia(mediaId)
    if (media.kind !== 'audio') throw new Error('配乐必须是音频素材')
    const [metadata] = await getAiEditorLocalMediaMetadata([mediaId])
    const durationMs = metadata?.durationSec ? Math.round(metadata.durationSec * 1000) : media.duration ? Math.round(media.duration * 1000) : null
    if (!durationMs || durationMs <= 0) throw new Error('无法读取配乐时长')
    const source = project.sources.find(item => item.mediaId === mediaId) ?? {
      id: randomUUID(), mediaId, name: media.name, kind: 'audio' as const, path: path.resolve(media.filePath),
      durationMs, width: null, height: null,
    }
    const next: LunaEditProject = {
      ...project,
      sources: project.sources.some(item => item.mediaId === mediaId) ? project.sources : [...project.sources, source],
      music: { sourceId: source.id, sourceStartMs: 0, sourceEndMs: durationMs, volume, ...(timing ? { timing } : {}) },
      musicEnabled: true,
      revision: project.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    const withUndo = withTaskUndo(project, next, taskId)
    await writeProjectAt(baseDir, withUndo)
    return withUndo
  })
}

export async function undoAiEditorProjectTask(
  baseDir: string,
  projectId: string,
  expectedRevision: number,
  taskId: string,
): Promise<LunaEditProject> {
  return withProjectOperation(baseDir, projectId, async () => {
    const raw = await readProject(projectPath(baseDir, projectId))
    if (!raw) throw new Error('剪辑工程不存在')
    const project = await resolveTrustedSources(raw)
    if (project.revision !== expectedRevision) throw new Error('工程版本已变化，请重新读取后再撤销')
    const history = project.aiUndo ?? []
    const last = history[history.length - 1]
    if (!last || last.taskId !== taskId || last.afterRevision !== project.revision) throw new Error('这项 Agent 修改已不是最近操作，不能安全撤销')
    const next: LunaEditProject = {
      ...last.before,
      revision: project.revision + 1,
      updatedAt: new Date().toISOString(),
      aiUndo: history.slice(0, -1),
    }
    await writeProjectAt(baseDir, next)
    return next
  })
}

export async function deleteAiEditorProject(baseDir: string, projectId: string): Promise<void> {
  await withProjectOperation(baseDir, projectId, async () => {
    const directory = projectDirectory(baseDir, projectId)
    const stats = await fs.lstat(directory).catch(() => null)
    if (stats?.isSymbolicLink()) throw new Error('项目目录无效')
    await fs.rm(directory, { recursive: true, force: true })
  })
}

export async function renameAiEditorProject(baseDir: string, projectId: string, name: string): Promise<EditProjectSummary> {
  return withProjectOperation(baseDir, projectId, async () => {
    const project = await readProject(projectPath(baseDir, projectId))
    if (!project) throw new Error('剪辑工程不存在')
    const next = { ...project, name: name.trim() || project.name, revision: project.revision + 1, updatedAt: new Date().toISOString() }
    await writeProjectAt(baseDir, next)
    return summary(next)
  })
}
