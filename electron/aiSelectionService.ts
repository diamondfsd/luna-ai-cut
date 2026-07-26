import { app } from 'electron'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import type {
  AiSelectionItem,
  AiSelectionProgress,
  AiSelectionSession,
  AiSelectionStartRequest,
  AiSelectionUserOperation,
  WorkspaceProject,
} from '../src/shared/types'
import { normalizeSelectionTarget } from './aiSelectionAlgorithms'
import { prepareImageEmbeddingModel } from './aiSelectionEmbedding'
import { readAiSelectionItemCache, writeAiSelectionItemCache } from './aiSelectionItemCache'
import { analyzeIndexedMedia, failedItem, indexMediaSource, pendingItem } from './aiSelectionMedia'
import { applyAiSelectionUserOperation, createAiSelectionSnapshot, type AiSelectionSnapshot } from './aiSelectionOperations'
import { analyzeContentOnDemand, analyzePeopleOnDemand, analyzeRecommendationEvidence, analyzeVideoPeopleOnDemand, analyzeVideosOnDemand } from './aiSelectionOnDemandAnalysis'
import { loadGlobalPeople, mergeGlobalPeople, registerGlobalPeople, renameGlobalPerson, setGlobalPersonAvatar, unmergeGlobalPerson } from './aiSelectionPeopleManager'
import { rebuildSelectionResult } from './aiSelectionResult'
import { refreshAiSelectionCounts } from './aiSelectionSessionState'
import { getSettings } from './settingsService'
import { createWorkspaceProject } from './workspaceProjectService'
import { workspaceAssetsFromSelection } from './aiSelectionWorkspaceAssets'

const ANALYSIS_VERSION = 'selection-evidence-v6'
const ROOT_DIR = 'ai-selection'
interface StoredSession extends AiSelectionSession {
  undoStack: AiSelectionSnapshot[]
  redoStack: AiSelectionSnapshot[]
}
type Notify = (event: 'progress' | 'session', payload: AiSelectionProgress | AiSelectionSession) => void
const sessions = new Map<string, StoredSession>()
let loaded = false
let activeSessionId: string | null = null
let activeController: AbortController | null = null
let notify: Notify = () => undefined

export function setAiSelectionNotifier(next: Notify): void {
  notify = next
}

function rootDir(): string {
  return path.join(app.getPath('userData'), '.luna-cache', ROOT_DIR)
}

function peopleStoreDir(): string {
  return path.join(app.getPath('userData'), 'people')
}

function sessionPath(id: string): string {
  if (!/^selection_[a-z0-9_-]+$/i.test(id)) throw new Error('选片任务标识无效')
  return path.join(rootDir(), 'sessions', `${id}.json`)
}

async function readCachedItem(id: string, preset: AiSelectionSession['preset']): Promise<AiSelectionItem | null> {
  return readAiSelectionItemCache(rootDir(), ANALYSIS_VERSION, id, preset)
}

async function writeCachedItem(item: AiSelectionItem, preset: AiSelectionSession['preset']): Promise<void> {
  await writeAiSelectionItemCache(rootDir(), ANALYSIS_VERSION, item, preset)
}

function publicSession(session: StoredSession): AiSelectionSession {
  const { undoStack, redoStack, ...value } = session
  return structuredClone({
    ...value,
    items: value.items.map((item) => ({ ...item, imageEmbedding: null, personEvidence: item.personEvidence ? { ...item.personEvidence, faces: item.personEvidence.faces?.map((face) => ({ ...face, embedding: null })) } : null })),
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
  })
}

function touch(session: StoredSession): void {
  session.revision += 1
  session.updatedAt = new Date().toISOString()
  refreshAiSelectionCounts(session)
}

async function persist(session: StoredSession): Promise<void> {
  const destination = sessionPath(session.id)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  await loadGlobalPeople(peopleStoreDir())
  const directory = path.join(rootDir(), 'sessions')
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8')) as StoredSession
      if (parsed.schemaVersion !== 1 || parsed.analysisVersion !== ANALYSIS_VERSION || !parsed.id) continue
      parsed.undoStack ??= []
      parsed.redoStack ??= []
      parsed.faceGroups = await registerGlobalPeople(peopleStoreDir(), parsed.items)
      rebuildSelectionResult(parsed)
      if (parsed.status === 'indexing' || parsed.status === 'analyzing') parsed.status = 'interrupted'
      refreshAiSelectionCounts(parsed)
      sessions.set(parsed.id, parsed)
    } catch {
      // Ignore a damaged session; other sessions remain available.
    }
  }
}

function emitSession(session: StoredSession): void {
  notify('session', publicSession(session))
}

function emitProgress(session: StoredSession, currentLabel: string | null): void {
  notify('progress', {
    sessionId: session.id,
    revision: session.revision,
    status: session.status,
    phase: session.phase,
    counts: session.counts,
    currentLabel,
  })
}

async function updateAndPersist(session: StoredSession, currentLabel: string | null = null): Promise<void> {
  touch(session)
  await persist(session)
  emitProgress(session, currentLabel)
  emitSession(session)
}

function abortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|已取消/i.test(error.message))
}

async function runSession(session: StoredSession): Promise<void> {
  const controller = new AbortController()
  activeSessionId = session.id
  activeController = controller
  try {
    session.status = 'indexing'
    session.phase = 'indexing'
    session.error = null
    await updateAndPersist(session)
    const indexed = await indexMediaSource(session.source, controller.signal)
    session.counts.total = indexed.length
    const previousItems = new Map(session.items.map((item) => [item.id, item]))
    session.items = indexed.map((media) => previousItems.get(media.id) ?? pendingItem(media))
    rebuildSelectionResult(session)
    await updateAndPersist(session)
    const completed = new Set(session.items.filter((item) => item.analysisState !== 'pending').map((item) => item.id))
    const sizeCounts = new Map<number, number>()
    indexed.forEach((item) => sizeCounts.set(item.bytes, (sizeCounts.get(item.bytes) ?? 0) + 1))
    session.status = 'analyzing'
    session.phase = 'metadata'
    await updateAndPersist(session)

    const ordered = [...indexed].sort((a, b) => Number(a.kind === 'video') - Number(b.kind === 'video') || a.path.localeCompare(b.path))
    const photos = ordered.filter((item) => item.kind === 'image')
    const videos = ordered.filter((item) => item.kind === 'video')
    session.phase = 'photos'
    let embeddingModel: Awaited<ReturnType<typeof prepareImageEmbeddingModel>> | undefined
    if (photos.length > 0) {
      await updateAndPersist(session, '准备视觉模型')
      embeddingModel = await prepareImageEmbeddingModel(controller.signal)
    }
    const pendingPhotos = photos.filter((item) => !completed.has(item.id))
    for (let offset = 0; offset < pendingPhotos.length; offset += 3) {
      controller.signal.throwIfAborted()
      const batch = pendingPhotos.slice(offset, offset + 3)
      const analyzed = await Promise.all(batch.map(async (media): Promise<AiSelectionItem> => {
        try {
          const needsExactHash = (sizeCounts.get(media.bytes) ?? 0) > 1
          const cached = await readCachedItem(media.id, session.preset)
          const reusable = cached && (!needsExactHash || Boolean(cached.exactHash)) ? cached : null
          const item = reusable ?? await analyzeIndexedMedia(media, session.preset, needsExactHash, controller.signal, embeddingModel)
          if (!reusable) await writeCachedItem(item, session.preset)
          return item
        } catch (error) {
          if (abortLike(error)) throw error
          return failedItem(media, error)
        }
      }))
      for (const item of analyzed) session.items.splice(session.items.findIndex((candidate) => candidate.id === item.id), 1, item)
      rebuildSelectionResult(session)
      await updateAndPersist(session, batch[batch.length - 1]?.name ?? null)
    }

    controller.signal.throwIfAborted()
    session.phase = 'grouping'
    rebuildSelectionResult(session)
    session.phase = 'ranking'
    await updateAndPersist(session)

    session.phase = 'videos'
    await updateAndPersist(session)
    const pendingVideos = videos.filter((item) => !completed.has(item.id))
    const videoConcurrency = os.totalmem() >= 16 * 1024 ** 3 ? 2 : 1
    for (let offset = 0; offset < pendingVideos.length; offset += videoConcurrency) {
      controller.signal.throwIfAborted()
      const batch = pendingVideos.slice(offset, offset + videoConcurrency)
      const analyzed = await Promise.all(batch.map(async (media): Promise<AiSelectionItem> => {
        try {
          // Large videos never receive a full-file hash during the first pass.
          const cached = await readCachedItem(media.id, session.preset)
          const item = cached ?? await analyzeIndexedMedia(media, session.preset, false, controller.signal)
          if (!cached) await writeCachedItem(item, session.preset)
          return item
        } catch (error) {
          if (abortLike(error)) throw error
          return failedItem(media, error)
        }
      }))
      for (const item of analyzed) session.items.splice(session.items.findIndex((candidate) => candidate.id === item.id), 1, item)
      rebuildSelectionResult(session)
      await updateAndPersist(session, batch[batch.length - 1]?.name ?? null)
    }

    rebuildSelectionResult(session)
    session.phase = 'ranking'
    await updateAndPersist(session)
    session.phase = 'done'
    session.status = 'ready'
    await updateAndPersist(session)

    // 人物与内容证据属于增量增强：基础结果可用后再继续补充，不阻塞选片。
    try {
      await analyzeRecommendationEvidence(analysisContext(session), photos.map((item) => item.id), controller.signal)
      session.faceGroups = await registerGlobalPeople(peopleStoreDir(), session.items)
      rebuildSelectionResult(session)
      await updateAndPersist(session)
      await analyzeVideoPeopleOnDemand(analysisContext(session), videos.map((item) => item.id), controller.signal)
      session.faceGroups = await registerGlobalPeople(peopleStoreDir(), session.items)
      rebuildSelectionResult(session)
    } catch (error) {
      if (abortLike(error)) throw error
    }
    session.phase = 'done'
    await updateAndPersist(session)
  } catch (error) {
    if (!abortLike(error)) {
      session.status = 'failed'
      session.error = error instanceof Error ? error.message : String(error)
      await updateAndPersist(session)
    }
  } finally {
    if (activeSessionId === session.id) {
      activeSessionId = null
      activeController = null
    }
    queueMicrotask(() => { void scheduleNext() })
  }
}

async function scheduleNext(): Promise<void> {
  await ensureLoaded()
  if (activeSessionId) return
  const next = [...sessions.values()]
    .filter((session) => session.status === 'queued')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
  if (next) void runSession(next)
}

function requireSession(id: string): StoredSession {
  const session = sessions.get(id)
  if (!session) throw new Error('选片任务不存在')
  return session
}

export async function startAiSelection(request: AiSelectionStartRequest): Promise<AiSelectionSession> {
  await ensureLoaded()
  const now = new Date().toISOString()
  const id = `selection_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const session: StoredSession = {
    schemaVersion: 1,
    analysisVersion: ANALYSIS_VERSION,
    id,
    name: request.name?.trim() || request.source.label || 'AI 选片',
    source: structuredClone(request.source),
    preset: request.preset,
    purpose: request.purpose ?? 'general',
    target: normalizeSelectionTarget(request.target ?? { mode: 'preset', value: null }),
    status: 'queued',
    phase: 'indexing',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    counts: { total: 0, completed: 0, failed: 0, recommended: 0, attention: 0, kept: 0, rejected: 0, undecided: 0 },
    items: [],
    scenes: [],
    groups: [],
    faceGroups: [],
    preferenceProfile: {
      sampleCount: 0,
      weights: { quality: 0.4, people: 0.2, composition: 0.1, relevance: 0.2, diversity: 0.1 },
    },
    workspaceCreation: { status: 'idle', projectId: null, error: null },
    error: null,
    canUndo: false,
    canRedo: false,
    undoStack: [],
    redoStack: [],
  }
  sessions.set(id, session)
  await persist(session)
  emitSession(session)
  void scheduleNext()
  return publicSession(session)
}

export async function listAiSelectionSessions(): Promise<AiSelectionSession[]> {
  await ensureLoaded()
  return [...sessions.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(publicSession)
}

export async function getAiSelectionSession(id: string): Promise<AiSelectionSession | null> {
  await ensureLoaded()
  const session = sessions.get(id)
  return session ? publicSession(session) : null
}

export async function pauseAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (session.status === 'queued' || activeSessionId === id) {
    session.status = 'paused'
    if (activeSessionId === id) activeController?.abort()
    await updateAndPersist(session)
  }
  return publicSession(session)
}

export async function resumeAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (['paused', 'interrupted', 'failed', 'canceled'].includes(session.status)) {
    session.status = 'queued'
    session.error = null
    await updateAndPersist(session)
    void scheduleNext()
  }
  return publicSession(session)
}

export async function cancelAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (session.status !== 'completed') {
    session.status = 'canceled'
    if (activeSessionId === id) activeController?.abort()
    await updateAndPersist(session)
  }
  return publicSession(session)
}

function restoreSnapshot(session: StoredSession, snapshot: AiSelectionSnapshot): void {
  session.preset = snapshot.preset
  session.purpose = snapshot.purpose
  session.target = structuredClone(snapshot.target)
  session.items = structuredClone(snapshot.items)
  session.scenes = structuredClone(snapshot.scenes)
  session.groups = structuredClone(snapshot.groups)
  session.preferenceProfile = structuredClone(snapshot.preferenceProfile)
}

export async function applyAiSelectionOperation(id: string, revision: number, operation: AiSelectionUserOperation): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  if (revision > session.revision) throw new Error('选片结果版本无效')
  session.undoStack.push(createAiSelectionSnapshot(session))
  session.undoStack = session.undoStack.slice(-20)
  session.redoStack = []
  applyAiSelectionUserOperation(session, operation)
  await updateAndPersist(session)
  return publicSession(session)
}

export async function undoAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  const snapshot = session.undoStack.pop()
  if (snapshot) { session.redoStack.push(createAiSelectionSnapshot(session)); restoreSnapshot(session, snapshot); await updateAndPersist(session) }
  return publicSession(session)
}

export async function redoAiSelection(id: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  const snapshot = session.redoStack.pop()
  if (snapshot) { session.undoStack.push(createAiSelectionSnapshot(session)); restoreSnapshot(session, snapshot); await updateAndPersist(session) }
  return publicSession(session)
}

export async function analyzeAiSelectionPeople(id: string, itemIds: string[]): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await analyzePeopleOnDemand(analysisContext(session), itemIds)
  session.faceGroups = await registerGlobalPeople(peopleStoreDir(), session.items)
  await updateAndPersist(session)
  return publicSession(session)
}

async function persistPeopleAndRefreshSessions(): Promise<void> {
  for (const session of sessions.values()) {
    rebuildSelectionResult(session)
    await updateAndPersist(session)
  }
}

export async function renameAiSelectionPerson(id: string, groupId: string, name: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await renameGlobalPerson(peopleStoreDir(), session, groupId, name)
  await persistPeopleAndRefreshSessions()
  return publicSession(session)
}

export async function setAiSelectionPersonAvatar(id: string, groupId: string, itemId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await setGlobalPersonAvatar(peopleStoreDir(), session, groupId, itemId, bounds)
  await persistPeopleAndRefreshSessions()
  return publicSession(session)
}

export async function mergeAiSelectionPeople(id: string, targetGroupId: string, sourceGroupId: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await mergeGlobalPeople(peopleStoreDir(), session, targetGroupId, sourceGroupId)
  await persistPeopleAndRefreshSessions()
  return publicSession(session)
}

export async function unmergeAiSelectionPerson(id: string, targetGroupId: string, memberIdentityId: string): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await unmergeGlobalPerson(peopleStoreDir(), session, targetGroupId, memberIdentityId)
  await persistPeopleAndRefreshSessions()
  return publicSession(session)
}

export async function analyzeAiSelectionContentTags(id: string, itemIds: string[]): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await analyzeContentOnDemand(analysisContext(session), itemIds)
  return publicSession(session)
}

export async function analyzeAiSelectionVideos(id: string, itemIds: string[]): Promise<AiSelectionSession> {
  await ensureLoaded()
  const session = requireSession(id)
  await analyzeVideosOnDemand(analysisContext(session), itemIds)
  return publicSession(session)
}

function analysisContext(session: StoredSession) {
  return {
    session,
    cacheRoot: rootDir(),
    writeCachedItem: (item: AiSelectionItem) => writeCachedItem(item, session.preset),
    update: (label?: string | null) => updateAndPersist(session, label),
    rebuild: () => rebuildSelectionResult(session),
  }
}

export async function createProjectFromAiSelection(id: string, name: string): Promise<WorkspaceProject> {
  await ensureLoaded()
  const session = requireSession(id)
  if (session.workspaceCreation.status === 'creating') throw new Error('工作台项目正在创建')
  if (session.workspaceCreation.status === 'created') throw new Error('这个任务已经创建过工作台项目')
  const assets = workspaceAssetsFromSelection(session.items)
  if (assets.length === 0) throw new Error('请先选择至少一个可用素材')
  session.workspaceCreation = { status: 'creating', projectId: null, error: null }
  await updateAndPersist(session)
  try {
    const settings = await getSettings()
    const project = await createWorkspaceProject(settings.downloadDir, name.trim() || session.name, assets)
    session.workspaceCreation = { status: 'created', projectId: project.id, error: null }
    session.status = 'completed'
    await updateAndPersist(session)
    return project
  } catch (error) {
    session.workspaceCreation = { status: 'failed', projectId: null, error: error instanceof Error ? error.message : String(error) }
    await updateAndPersist(session)
    throw error
  }
}

export async function removeAiSelectionSession(id: string): Promise<void> {
  await ensureLoaded()
  if (activeSessionId === id) throw new Error('请先暂停或取消当前任务')
  sessions.delete(id)
  await fs.rm(sessionPath(id), { force: true })
}
