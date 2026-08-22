import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'

import type {
  RemotionClip,
  RemotionClipCreateInput,
  RemotionClipStatus,
  RemotionSourceFiles,
  RemotionSourceSnapshot,
  RemotionSourceUpdateRequest,
} from '../src/shared/types/remotion'

const CLIPS_DIRECTORY = 'remotion-clips'
const SOURCE_DIRECTORY = 'src'
const CLIP_FILE = 'clip.json'
const ENTRY_FILE = 'entry.tsx' as const
const FREECUT_PROJECTS_DIRECTORY = path.join('freecut-workspace', 'projects')
const LEGACY_PROJECTS_DIRECTORY = 'workspace-projects'
const MAX_SOURCE_FILE_COUNT = 128
const MAX_SOURCE_FILE_BYTES = 1_000_000
const MAX_SOURCE_TOTAL_BYTES = 8_000_000
const DEFAULT_COMPOSITION_ID = 'remotion-clip'
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const DEFAULT_FPS = 30
const DEFAULT_DURATION_IN_FRAMES = 150
export const REMOTION_CLIP_ENTRY_SOURCE = `import { registerRoot } from 'remotion'
import Root from './src/Root'

registerRoot(Root)
`

const DEFAULT_SOURCE = `import { AbsoluteFill, Composition, Img } from 'remotion'

type MediaInput = { id: string; name: string; src: string }
type ClipProps = { media: MediaInput[] }

function RemotionClipComposition({ media }: ClipProps) {
  const firstMedia = media[0]
  return (
    <AbsoluteFill style={{ backgroundColor: '#101418', color: '#f7f8fb', fontFamily: 'Arial, sans-serif' }}>
      {firstMedia ? <Img src={firstMedia.src} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} /> : null}
      <AbsoluteFill style={{ justifyContent: 'center', padding: 96 }}>
        <div style={{ color: '#8db8f5', fontSize: 28, fontWeight: 700, letterSpacing: 5 }}>FREECUT / REMOTION CLIP</div>
        <div style={{ marginTop: 24, fontSize: 96, fontWeight: 800 }}>Editable TSX composition</div>
        <div style={{ marginTop: 28, color: '#c8d0df', fontSize: 32 }}>这段画面由项目内的 Remotion 源码生成。</div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export default function RemotionClipRoot() {
  return (
    <Composition
      id="remotion-clip"
      component={RemotionClipComposition}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={150}
      defaultProps={{ media: [] }}
    />
  )
}
`

function validateProjectId(projectId: string): void {
  if (typeof projectId !== 'string' || !/^[\w.-]{1,100}$/u.test(projectId) || projectId === '.' || projectId === '..') {
    throw new TypeError('项目标识无效')
  }
}

function validateClipId(clipId: string): void {
  if (typeof clipId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/u.test(clipId)) throw new TypeError('RemotionClip 标识无效')
}

function validateCompositionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(value)) throw new TypeError('Remotion composition 标识无效')
  return value
}

function validateInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return value
}

function clipDirectory(baseDir: string, projectId: string, clipId: string): string {
  validateProjectId(projectId)
  validateClipId(clipId)
  return path.join(projectDirectory(baseDir, projectId), CLIPS_DIRECTORY, clipId)
}

/**
 * FreeCut projects live in the new workspace filesystem. Keep the legacy
 * directory as a read/write fallback for projects created by the old Luna
 * workspace surface while they are still supported elsewhere in the app.
 */
function projectDirectory(baseDir: string, projectId: string): string {
  validateProjectId(projectId)
  const freecutDirectory = path.resolve(baseDir, FREECUT_PROJECTS_DIRECTORY, projectId)
  if (existsSync(path.join(freecutDirectory, 'project.json'))) return freecutDirectory
  return path.resolve(baseDir, LEGACY_PROJECTS_DIRECTORY, projectId)
}

export function remotionProjectDirectory(baseDir: string, projectId: string): string {
  return projectDirectory(baseDir, projectId)
}

function sourceDirectory(baseDir: string, projectId: string, clipId: string): string {
  return path.join(clipDirectory(baseDir, projectId, clipId), SOURCE_DIRECTORY)
}

function clipFilePath(baseDir: string, projectId: string, clipId: string): string {
  return path.join(clipDirectory(baseDir, projectId, clipId), CLIP_FILE)
}

function artifactDirectory(baseDir: string, projectId: string, clipId: string): string {
  return path.join(clipDirectory(baseDir, projectId, clipId), 'artifacts')
}

function validateSourcePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length < 9 || filePath.length > 240) throw new TypeError('Remotion 源码路径无效')
  const normalized = filePath.replaceAll('\\', '/')
  if (!normalized.startsWith('src/') || normalized.includes('..') || normalized.includes('//')) throw new TypeError('Remotion 源码必须位于 src 目录内')
  if (!/\.(?:tsx|ts)$/u.test(normalized)) throw new TypeError('Remotion 源码只支持 .tsx 或 .ts 文件')
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) throw new TypeError('Remotion 源码路径无效')
  return normalized
}

function sourceEntries(files: Record<string, string>): Array<[string, string]> {
  const entries = Object.entries(files).map(([filePath, content]) => {
    const normalized = validateSourcePath(filePath)
    if (typeof content !== 'string') throw new TypeError(`Remotion 源码内容无效：${normalized}`)
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > MAX_SOURCE_FILE_BYTES) throw new RangeError(`Remotion 源码文件过大：${normalized}`)
    return [normalized, content] as [string, string]
  }).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0 || entries.length > MAX_SOURCE_FILE_COUNT) throw new RangeError('Remotion 源码文件数量无效')
  if (!entries.some(([filePath]) => filePath === 'src/Root.tsx')) throw new Error('RemotionClip 必须包含 src/Root.tsx')
  const totalBytes = entries.reduce((total, [, content]) => total + Buffer.byteLength(content, 'utf8'), 0)
  if (totalBytes > MAX_SOURCE_TOTAL_BYTES) throw new RangeError('Remotion 源码总大小超过限制')
  return entries
}

export function remotionSourceHash(files: Record<string, string>): string {
  const hash = createHash('sha256')
  for (const [filePath, content] of sourceEntries(files)) {
    hash.update(filePath)
    hash.update('\0')
    hash.update(content, 'utf8')
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function ensureProject(baseDir: string, projectId: string): Promise<void> {
  validateProjectId(projectId)
  const projectFile = path.join(projectDirectory(baseDir, projectId), 'project.json')
  try {
    const stats = await fs.stat(projectFile)
    if (!stats.isFile()) throw new Error('项目不存在')
    const project = JSON.parse(await fs.readFile(projectFile, 'utf8')) as { id?: unknown }
    if (project.id !== projectId) throw new Error('项目不存在')
  } catch (error) {
    if (error instanceof Error && error.message === '项目不存在') throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('项目不存在')
    throw error
  }
}

async function readSourceFiles(directory: string): Promise<RemotionSourceFiles> {
  const files: Record<string, string> = {}
  async function visit(current: string, relativeDirectory: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Remotion 源码不支持符号链接')
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute, relative)
      else if (entry.isFile() && /\.(?:tsx|ts)$/u.test(entry.name)) {
        const content = await fs.readFile(absolute, 'utf8')
        files[`src/${relative}`] = content
      }
    }
  }
  await visit(directory, '')
  return sourceEntries(files).reduce<RemotionSourceFiles>((result, [filePath, content]) => {
    result[filePath] = content
    return result
  }, {} as RemotionSourceFiles)
}

async function writeSourceTree(directory: string, files: Record<string, string>): Promise<void> {
  const entries = sourceEntries(files)
  await fs.mkdir(directory, { recursive: true })
  for (const [filePath, content] of entries) {
    const relative = filePath.slice('src/'.length)
    const target = path.join(directory, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 })
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.rename(temporary, filePath)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

function statusForClip(clip: RemotionClip): RemotionClipStatus {
  if (clip.status === 'rendering') return 'rendering'
  if (clip.artifact?.sourceRevision !== clip.sourceRevision || clip.artifact?.sourceHash !== clip.sourceHash) return 'dirty'
  return clip.artifact ? 'ready' : clip.status === 'failed' ? 'failed' : 'dirty'
}

async function artifactIsPresent(directory: string, artifact: NonNullable<RemotionClip['artifact']> | undefined): Promise<boolean> {
  if (!artifact || !artifact.outputPath.startsWith('artifacts/') || !artifact.manifestPath.startsWith('artifacts/')) return false
  if (artifact.outputPath.includes('..') || artifact.manifestPath.includes('..')) return false
  const [outputStats, manifestStats] = await Promise.all([
    fs.stat(path.join(directory, artifact.outputPath)).catch(() => null),
    fs.stat(path.join(directory, artifact.manifestPath)).catch(() => null),
  ])
  return Boolean(outputStats?.isFile() && manifestStats?.isFile() && outputStats.size === artifact.fileSize)
}

async function readClipFile(baseDir: string, projectId: string, clipId: string): Promise<RemotionClip | null> {
  try {
    const raw = await fs.readFile(clipFilePath(baseDir, projectId, clipId), 'utf8')
    const clip = JSON.parse(raw) as RemotionClip
    if (!clip || clip.projectId !== projectId || clip.clipId !== clipId) return null
    const hasArtifact = await artifactIsPresent(clipDirectory(baseDir, projectId, clipId), clip.artifact)
    return { ...clip, status: hasArtifact ? statusForClip(clip) : clip.artifact ? 'dirty' : statusForClip(clip) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function createRemotionClip(
  baseDir: string,
  projectId: string,
  input: RemotionClipCreateInput = {},
): Promise<RemotionClip> {
  await ensureProject(baseDir, projectId)
  const clipId = `clip-${randomUUID()}`
  const directory = clipDirectory(baseDir, projectId, clipId)
  const files = input.files ?? { 'src/Root.tsx': DEFAULT_SOURCE }
  const normalizedFiles = sourceEntries(files).reduce<RemotionSourceFiles>((result, [filePath, content]) => {
    result[filePath] = content
    return result
  }, {} as RemotionSourceFiles)
  const now = new Date().toISOString()
  const clip: RemotionClip = {
    clipId,
    projectId,
    entryFile: ENTRY_FILE,
    compositionId: validateCompositionId(input.compositionId ?? DEFAULT_COMPOSITION_ID),
    compositionVersion: 1,
    sourceRevision: 1,
    sourceHash: remotionSourceHash(normalizedFiles),
    width: validateInteger(input.width ?? DEFAULT_WIDTH, 'Remotion 宽度', 320, 3_840),
    height: validateInteger(input.height ?? DEFAULT_HEIGHT, 'Remotion 高度', 320, 3_840),
    fps: validateInteger(input.fps ?? DEFAULT_FPS, 'Remotion 帧率', 1, 60),
    durationInFrames: validateInteger(input.durationInFrames ?? DEFAULT_DURATION_IN_FRAMES, 'Remotion 时长', 1, 60 * 60 * 10),
    mediaIds: [...new Set((input.mediaIds ?? []).map((mediaId) => {
      if (typeof mediaId !== 'string' || !/^[\w.-]{1,200}$/u.test(mediaId)) throw new TypeError('Remotion 素材标识无效')
      return mediaId
    }))],
    status: 'dirty',
    createdAt: now,
    updatedAt: now,
  }
  await fs.mkdir(path.join(directory, 'artifacts'), { recursive: true })
  await writeSourceTree(path.join(directory, SOURCE_DIRECTORY), normalizedFiles)
  await fs.writeFile(path.join(directory, ENTRY_FILE), REMOTION_CLIP_ENTRY_SOURCE, { encoding: 'utf8', mode: 0o600 })
  await writeFileForClip(baseDir, projectId, clipId, clip)
  return clip
}

async function writeFileForClip(baseDir: string, projectId: string, clipId: string, clip: RemotionClip): Promise<void> {
  const filePath = clipFilePath(baseDir, projectId, clipId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeJsonAtomic(filePath, clip)
}

export async function listRemotionClips(baseDir: string, projectId: string): Promise<RemotionClip[]> {
  await ensureProject(baseDir, projectId)
  const directory = path.join(projectDirectory(baseDir, projectId), CLIPS_DIRECTORY)
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const clips = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readClipFile(baseDir, projectId, entry.name)))
  return clips.filter((clip): clip is RemotionClip => Boolean(clip)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getRemotionClip(baseDir: string, projectId: string, clipId: string): Promise<RemotionClip | null> {
  await ensureProject(baseDir, projectId)
  return readClipFile(baseDir, projectId, clipId)
}

export async function readRemotionSource(baseDir: string, projectId: string, clipId: string): Promise<RemotionSourceSnapshot> {
  const clip = await getRemotionClip(baseDir, projectId, clipId)
  if (!clip) throw new Error('RemotionClip 不存在')
  const files = await readSourceFiles(sourceDirectory(baseDir, projectId, clipId))
  const sourceHash = remotionSourceHash(files)
  if (sourceHash !== clip.sourceHash) throw new Error('RemotionClip 源码校验失败，请重新打开项目')
  return { clipId, sourceRevision: clip.sourceRevision, sourceHash, files }
}

export async function updateRemotionSource(
  baseDir: string,
  request: RemotionSourceUpdateRequest,
): Promise<RemotionClip> {
  const clip = await getRemotionClip(baseDir, request.projectId, request.clipId)
  if (!clip) throw new Error('RemotionClip 不存在')
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision !== clip.sourceRevision) {
    throw new Error(`RemotionClip 源码版本已变化，当前版本为 ${clip.sourceRevision}`)
  }
  const current = await readSourceFiles(sourceDirectory(baseDir, request.projectId, request.clipId))
  const next = { ...current } as RemotionSourceFiles
  for (const filePath of request.removeFiles ?? []) delete next[validateSourcePath(filePath)]
  for (const [filePath, content] of Object.entries(request.files ?? {})) next[validateSourcePath(filePath)] = content as string
  const normalized = sourceEntries(next).reduce<RemotionSourceFiles>((result, [filePath, content]) => {
    result[filePath] = content
    return result
  }, {} as RemotionSourceFiles)
  const directory = clipDirectory(baseDir, request.projectId, request.clipId)
  const stagedSource = path.join(directory, `.src-${randomUUID()}`)
  const previousSource = path.join(directory, `.src-previous-${randomUUID()}`)
  await writeSourceTree(stagedSource, normalized)
  try {
    await fs.rename(sourceDirectory(baseDir, request.projectId, request.clipId), previousSource)
    await fs.rename(stagedSource, sourceDirectory(baseDir, request.projectId, request.clipId))
  } catch (error) {
    await fs.rename(previousSource, sourceDirectory(baseDir, request.projectId, request.clipId)).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(stagedSource, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(previousSource, { recursive: true, force: true }).catch(() => undefined)
  }
  const updated: RemotionClip = {
    ...clip,
    sourceRevision: clip.sourceRevision + 1,
    sourceHash: remotionSourceHash(normalized),
    status: 'dirty',
    error: undefined,
    updatedAt: new Date().toISOString(),
  }
  await writeFileForClip(baseDir, request.projectId, request.clipId, updated)
  return updated
}

export function remotionClipSourceDirectory(baseDir: string, projectId: string, clipId: string): string {
  return sourceDirectory(baseDir, projectId, clipId)
}

export function remotionClipDirectory(baseDir: string, projectId: string, clipId: string): string {
  return clipDirectory(baseDir, projectId, clipId)
}

export function remotionClipArtifactDirectory(baseDir: string, projectId: string, clipId: string): string {
  return artifactDirectory(baseDir, projectId, clipId)
}

export async function updateRemotionClipAfterRender(
  baseDir: string,
  projectId: string,
  clipId: string,
  artifact: RemotionClip['artifact'],
  sourceRevision: number,
  sourceHash: string,
  durationInFrames?: number,
): Promise<RemotionClip | null> {
  const clip = await getRemotionClip(baseDir, projectId, clipId)
  if (!clip) return null
  if (clip.sourceRevision !== sourceRevision || clip.sourceHash !== sourceHash) return clip
  const updated = {
    ...clip,
    ...(durationInFrames !== undefined ? { durationInFrames } : {}),
    artifact,
    status: 'ready' as const,
    error: undefined,
    updatedAt: new Date().toISOString(),
  }
  await writeFileForClip(baseDir, projectId, clipId, updated)
  return updated
}

export async function attachRemotionClipMedia(
  baseDir: string,
  projectId: string,
  clipId: string,
  mediaId: string,
): Promise<RemotionClip | null> {
  const clip = await getRemotionClip(baseDir, projectId, clipId)
  if (!clip?.artifact) return clip
  if (clip.artifact.mediaId === mediaId) return clip
  const updated = {
    ...clip,
    artifact: { ...clip.artifact, mediaId },
    updatedAt: new Date().toISOString(),
  }
  await writeFileForClip(baseDir, projectId, clipId, updated)
  return updated
}

export async function markRemotionClipRenderFailed(
  baseDir: string,
  projectId: string,
  clipId: string,
  sourceRevision: number,
  sourceHash: string,
  error: string,
): Promise<void> {
  const clip = await getRemotionClip(baseDir, projectId, clipId)
  if (!clip || clip.sourceRevision !== sourceRevision || clip.sourceHash !== sourceHash) return
  await writeFileForClip(baseDir, projectId, clipId, { ...clip, status: 'failed', error, updatedAt: new Date().toISOString() })
}

export async function markRemotionClipRendering(
  baseDir: string,
  projectId: string,
  clipId: string,
  sourceRevision: number,
  sourceHash: string,
): Promise<void> {
  const clip = await getRemotionClip(baseDir, projectId, clipId)
  if (!clip || clip.sourceRevision !== sourceRevision || clip.sourceHash !== sourceHash) return
  await writeFileForClip(baseDir, projectId, clipId, { ...clip, status: 'rendering', error: undefined, updatedAt: new Date().toISOString() })
}

export async function refreshRemotionClipStatus(baseDir: string, projectId: string, clipId: string): Promise<RemotionClip | null> {
  const clip = await getRemotionClip(baseDir, projectId, clipId)
  if (!clip) return null
  const status = statusForClip({ ...clip, status: 'dirty' })
  if (clip.status === status) return clip
  const updated = { ...clip, status, updatedAt: new Date().toISOString() }
  await writeFileForClip(baseDir, projectId, clipId, updated)
  return updated
}
