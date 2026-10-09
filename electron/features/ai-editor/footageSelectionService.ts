import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { FootageSelectionItem, FootageSelectionProject, FootageSelectionProjectSummary } from '../../../src/shared/types/aiEditing.ts'
import { getAiEditorLocalMedia } from './aiEditorLocalMediaService.ts'

const DIRECTORY = 'footage-selection-projects'
const operations = new Map<string, Promise<void>>()

function projectPath(baseDir: string, id: string): string {
  if (!/^[\w.-]{1,100}$/.test(id) || id === '.' || id === '..') throw new Error('选片项目编号无效')
  const root = path.resolve(baseDir, DIRECTORY)
  const destination = path.resolve(root, `${id}.json`)
  const relative = path.relative(root, destination)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('选片项目路径无效')
  }
  return destination
}

function emptyItem(mediaId: string): FootageSelectionItem {
  return { mediaId, decision: 'undecided', comment: '', tags: [], points: [], ranges: [], updatedAt: null }
}

function isProject(value: unknown): value is FootageSelectionProject {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<FootageSelectionProject>
  return project.schemaVersion === 1 && typeof project.id === 'string' && typeof project.name === 'string'
    && Number.isInteger(project.revision) && Boolean(project.items) && typeof project.items === 'object'
}

async function readProject(filePath: string): Promise<FootageSelectionProject | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
    return isProject(value) ? value : null
  } catch {
    return null
  }
}

async function writeProject(baseDir: string, project: FootageSelectionProject): Promise<void> {
  const destination = projectPath(baseDir, project.id)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function serial<T>(baseDir: string, id: string, task: () => Promise<T>): Promise<T> {
  const key = projectPath(baseDir, id)
  const previous = operations.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(task)
  const tail = result.then(() => undefined, () => undefined)
  operations.set(key, tail)
  try {
    return await result
  } finally {
    if (operations.get(key) === tail) operations.delete(key)
  }
}

function summary(project: FootageSelectionProject): FootageSelectionProjectSummary {
  return {
    projectId: project.id, projectName: project.name, createdAt: project.createdAt,
    updatedAt: project.updatedAt, revision: project.revision, itemCount: Object.keys(project.items).length,
    annotatedCount: Object.values(project.items).filter(item => item.decision !== 'undecided' || item.comment.trim() || item.points.length || item.ranges.length).length,
  }
}

export async function listFootageSelectionProjects(baseDir: string): Promise<FootageSelectionProjectSummary[]> {
  try {
    const root = path.resolve(baseDir, DIRECTORY)
    const entries = await fs.readdir(root, { withFileTypes: true })
    const projects = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => readProject(path.join(root, entry.name))))
    return projects.filter((project): project is FootageSelectionProject => Boolean(project))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(summary)
  } catch {
    return []
  }
}

export async function createFootageSelectionProject(baseDir: string, name: string, mediaIds: string[] = []): Promise<FootageSelectionProject> {
  const ids = [...new Set(mediaIds)].filter(value => typeof value === 'string' && value.trim())
  for (const mediaId of ids) await getAiEditorLocalMedia(mediaId)
  const now = new Date().toISOString()
  const project: FootageSelectionProject = {
    schemaVersion: 1, id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    name: name.trim() || '素材选片', createdAt: now, updatedAt: now, revision: 1,
    items: Object.fromEntries(ids.map(mediaId => [mediaId, emptyItem(mediaId)])),
  }
  await writeProject(baseDir, project)
  return project
}

export async function loadFootageSelectionProject(baseDir: string, id: string): Promise<FootageSelectionProject> {
  const project = await readProject(projectPath(baseDir, id))
  if (!project || project.id !== id) throw new Error('选片项目不存在')
  return project
}

async function validateSelection(project: FootageSelectionProject, saved: FootageSelectionProject): Promise<FootageSelectionProject> {
  if (!isProject(project) || project.id !== saved.id) throw new Error('选片数据格式无效')
  const items: Record<string, FootageSelectionItem> = {}
  for (const [mediaId, item] of Object.entries(project.items)) {
    if (!item || item.mediaId !== mediaId || !['undecided', 'liked', 'rejected'].includes(item.decision)
      || typeof item.comment !== 'string' || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')
      || item.comment.length > 4000 || item.tags.length > 100
      || !Array.isArray(item.points) || item.points.length > 1000 || !Array.isArray(item.ranges) || item.ranges.length > 1000
      || (item.updatedAt !== null && typeof item.updatedAt !== 'string')) throw new Error(`素材标注格式无效：${mediaId}`)
    await getAiEditorLocalMedia(mediaId)
    const points = item.points.map(point => {
      if (!point.id || !Number.isFinite(point.timeMs) || point.timeMs < 0 || typeof point.liked !== 'boolean' || typeof point.comment !== 'string') throw new Error(`时间点标注无效：${mediaId}`)
      return { ...point }
    })
    const ranges = item.ranges.map(range => {
      if (!range.id || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.startMs < 0
        || range.endMs <= range.startMs || typeof range.comment !== 'string' || typeof range.locked !== 'boolean') throw new Error(`片段标注无效：${mediaId}`)
      return { ...range }
    })
    items[mediaId] = { ...item, tags: [...new Set(item.tags.map(tag => tag.trim()).filter(Boolean))], points, ranges }
  }
  return { ...saved, name: project.name.trim() || saved.name, items }
}

export async function saveFootageSelectionProject(baseDir: string, incoming: FootageSelectionProject, expectedRevision: number): Promise<FootageSelectionProject> {
  return serial(baseDir, incoming.id, async () => {
    const saved = await loadFootageSelectionProject(baseDir, incoming.id)
    if (saved.revision !== expectedRevision) throw new Error('选片版本已变化，请重新读取')
    const next = await validateSelection(incoming, saved)
    next.revision = saved.revision + 1
    next.updatedAt = new Date().toISOString()
    for (const item of Object.values(next.items)) {
      if (item.decision !== 'undecided' || item.comment.trim() || item.points.length || item.ranges.length || item.tags.length) {
        item.updatedAt = item.updatedAt ?? next.updatedAt
      }
    }
    await writeProject(baseDir, next)
    return next
  })
}

export async function deleteFootageSelectionProject(baseDir: string, id: string): Promise<void> {
  await serial(baseDir, id, async () => { await fs.rm(projectPath(baseDir, id), { force: true }) })
}
