import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { safeName } from '../../media/filePathUtils.ts'
import { getSettings } from '../../storage/fileService.ts'
import { assignAiEditorMediaId } from '../ai-editor/aiEditorMediaCatalog.ts'
import { timingFromMidi } from './musicScoreTiming.ts'
import type { GeneratedMusicTiming } from '../../../src/shared/types/aiEditor'

const execFileAsync = promisify(execFile)
const WORKER_TIMEOUT_MS = 180_000
const MAX_DSL_BYTES = 256 * 1024

export interface MusicTemplateSummary {
  id: string
  file: string
  catalog: string
  tags: string[]
  sceneTags: string[]
  tempoBpm?: number
  density?: string
  dialogueSafe?: boolean
  description?: string
  sourceTitle?: string
  sourceComposer?: string
}

export interface MusicTemplateDocument extends MusicTemplateSummary {
  dsl: string
}

export interface GeneratedMusic {
  mediaId: string
  name: string
  kind: 'audio'
  durationSec: number
  bytes: number
  source: 'luna-bgm'
  musicTiming: GeneratedMusicTiming
}

interface MusicTemplateCatalogEntry {
  id?: unknown
  file?: unknown
  tags?: unknown
  scene_tags?: unknown
  tempo_bpm?: unknown
  density?: unknown
  dialogue_safe?: unknown
  description?: unknown
  source_title?: unknown
  source_composer?: unknown
}

interface WorkerRenderResult {
  wav?: unknown
  duration_seconds?: unknown
}

function bgmRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bgm')
    : path.join(app.getAppPath(), 'resources', 'bgm')
}

function workerPath(): string {
  const name = process.platform === 'win32' ? 'luna-bgm-worker.exe' : 'luna-bgm-worker'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'luna-render-core', name)
    : path.join(app.getAppPath(), 'luna-render-core', name)
}

async function runWorker<T>(args: string[]): Promise<T> {
  try {
    const result = await execFileAsync(workerPath(), args, {
      env: { ...process.env, BGM_PROJECT_ROOT: bgmRoot() },
      timeout: WORKER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    return JSON.parse(result.stdout.trim()) as T
  } catch (error) {
    const record = error as { stderr?: string; stdout?: string; message?: string }
    const details = record.stderr?.trim() || record.stdout?.trim() || record.message || String(error)
    throw new Error(details)
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function templateSummary(entry: MusicTemplateCatalogEntry, catalog: string): MusicTemplateSummary | null {
  if (typeof entry.id !== 'string' || typeof entry.file !== 'string') return null
  return {
    id: entry.id,
    file: entry.file,
    catalog,
    tags: stringArray(entry.tags),
    sceneTags: stringArray(entry.scene_tags),
    ...(typeof entry.tempo_bpm === 'number' ? { tempoBpm: entry.tempo_bpm } : {}),
    ...(typeof entry.density === 'string' ? { density: entry.density } : {}),
    ...(typeof entry.dialogue_safe === 'boolean' ? { dialogueSafe: entry.dialogue_safe } : {}),
    ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
    ...(typeof entry.source_title === 'string' ? { sourceTitle: entry.source_title } : {}),
    ...(typeof entry.source_composer === 'string' ? { sourceComposer: entry.source_composer } : {}),
  }
}

export async function listMusicTemplates(options: {
  tag?: string
  scene?: string
  dialogueSafe?: boolean
  limit?: number
} = {}): Promise<MusicTemplateSummary[]> {
  const args = ['templates', '--json']
  if (options.tag) args.push('--tag', options.tag)
  if (options.scene) args.push('--scene', options.scene)
  const entries = await runWorker<MusicTemplateCatalogEntry[]>(args)
  return entries
    .map((entry) => templateSummary(entry, typeof (entry as { catalog?: unknown }).catalog === 'string' ? String((entry as { catalog?: unknown }).catalog) : ''))
    .filter((entry): entry is MusicTemplateSummary => entry !== null)
    .filter((entry) => options.dialogueSafe === undefined || entry.dialogueSafe === options.dialogueSafe)
    .slice(0, Math.max(1, Math.min(options.limit ?? 50, 100)))
}

export async function getMusicTemplate(templateId: string): Promise<MusicTemplateDocument> {
  const entry = await runWorker<MusicTemplateCatalogEntry & { catalog?: unknown; dsl?: unknown }>([
    'template',
    '--id',
    templateId,
  ])
  const summary = templateSummary(
    entry,
    typeof entry.catalog === 'string' ? entry.catalog : '',
  )
  if (!summary || typeof entry.dsl !== 'string') throw new Error('音乐模板内容无效')
  return { ...summary, dsl: entry.dsl }
}

function outputFileName(name: string | undefined): string {
  const base = safeName(name?.trim() || `video-bgm-${new Date().toISOString().slice(0, 10)}`)
    .replace(/\s+/g, '-')
    .replace(/\.wav$/i, '')
    .slice(0, 80)
  return `${base || 'video-bgm'}-${randomUUID().slice(0, 8)}.wav`
}

export async function generateBackgroundMusic(dsl: string, name?: string): Promise<GeneratedMusic> {
  if (typeof dsl !== 'string' || !dsl.trim()) throw new Error('音乐 DSL 不能为空')
  if (Buffer.byteLength(dsl, 'utf8') > MAX_DSL_BYTES) throw new Error('音乐 DSL 过长')

  const settings = await getSettings()
  const outputDir = path.join(settings.baseDir, 'generated-music')
  const fileName = outputFileName(name)
  const outputPath = path.join(outputDir, fileName)
  const requestPath = path.join(app.getPath('temp'), `luna-bgm-${randomUUID()}.bgm`)
  await mkdir(outputDir, { recursive: true })
  await writeFile(requestPath, dsl, 'utf8')
  try {
    const result = await runWorker<WorkerRenderResult>([
      'render',
      '--dsl',
      requestPath,
      '--output',
      outputPath,
      '--keep-midi',
    ])
    const file = await stat(outputPath)
    if (!file.isFile() || file.size <= 44) throw new Error('音乐生成没有产生有效文件')
    const durationSec = typeof result.duration_seconds === 'number' && Number.isFinite(result.duration_seconds)
      ? result.duration_seconds
      : 0
    const musicTiming = timingFromMidi(await readFile(outputPath.replace(/\.wav$/i, '.mid')), durationSec)
    await writeFile(`${outputPath}.bgm`, dsl, 'utf8')
    await writeFile(`${outputPath}.timing.json`, JSON.stringify(musicTiming), 'utf8')
    return {
      mediaId: await assignAiEditorMediaId(settings.baseDir, outputPath, 'audio'),
      name: fileName,
      kind: 'audio',
      durationSec,
      bytes: file.size,
      source: 'luna-bgm',
      musicTiming,
    }
  } finally {
    await rm(requestPath, { force: true }).catch(() => undefined)
  }
}
