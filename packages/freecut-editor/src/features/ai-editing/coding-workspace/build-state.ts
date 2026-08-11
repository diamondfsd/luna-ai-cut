import { getProject, updateProject } from '@freecut/infrastructure/storage'
import { buildTimelineFromStores } from '@freecut/features/timeline/stores/timeline-persistence'
import type { Project } from '@freecut/types/project'
import type { EditProgram, EditProgramApplyResult } from '../edit-program/types'

const PUBLICATION_FIELD = 'aiEditingPublication'
const PUBLICATION_VERSION = 1

export interface TimelineBuildPublication {
  version: typeof PUBLICATION_VERSION
  sourceCommitId: string
  buildFingerprint: string
  revisionBefore: number
  revisionAfter: number
  receipt: EditProgramApplyResult
  publishedAt: number
}

export interface TimelineBuildStateStore {
  load(projectId: string): Promise<TimelineBuildPublication | null>
  save(projectId: string, publication: TimelineBuildPublication): Promise<void>
}

type ProjectWithPublication = Project & {
  [PUBLICATION_FIELD]?: unknown
}

function isFiniteRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parsePublication(value: unknown): TimelineBuildPublication | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('已保存的剪辑发布状态无效。')
  }
  const candidate = value as Partial<TimelineBuildPublication>
  if (
    candidate.version !== PUBLICATION_VERSION ||
    typeof candidate.sourceCommitId !== 'string' ||
    !candidate.sourceCommitId ||
    typeof candidate.buildFingerprint !== 'string' ||
    !candidate.buildFingerprint ||
    !isFiniteRevision(candidate.revisionBefore) ||
    !isFiniteRevision(candidate.revisionAfter) ||
    !isFiniteRevision(candidate.publishedAt) ||
    !candidate.receipt ||
    typeof candidate.receipt !== 'object'
  ) {
    throw new Error('已保存的剪辑发布状态无效。')
  }
  return candidate as TimelineBuildPublication
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Fingerprint the semantic build input. The working-copy baseline and preview mode
 * are intentionally excluded so a reopened session recognizes the same source build.
 */
export async function fingerprintTimelineBuild(program: EditProgram): Promise<string> {
  const semanticProgram = {
    version: program.version,
    sourceProjectId: program.sourceProjectId,
    intent: program.intent,
    operations: program.operations,
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(semanticProgram)),
  )
  return `sha256:${bytesToHex(digest)}`
}

export class ProjectTimelineBuildStateStore implements TimelineBuildStateStore {
  async load(projectId: string): Promise<TimelineBuildPublication | null> {
    const project = await getProject(projectId)
    if (!project) throw new Error('当前剪辑项目不存在。')
    return parsePublication((project as ProjectWithPublication)[PUBLICATION_FIELD])
  }

  async save(projectId: string, publication: TimelineBuildPublication): Promise<void> {
    // Timeline and receipt share one project.json replacement. A later normal
    // autosave updates only `timeline`, so this top-level receipt is preserved.
    const updates = {
      timeline: buildTimelineFromStores(),
      [PUBLICATION_FIELD]: publication,
    } as Partial<Project>
    await updateProject(projectId, updates)
  }
}

export function createTimelineBuildPublication(input: {
  sourceCommitId: string
  buildFingerprint: string
  receipt: EditProgramApplyResult
}): TimelineBuildPublication {
  return {
    version: PUBLICATION_VERSION,
    sourceCommitId: input.sourceCommitId,
    buildFingerprint: input.buildFingerprint,
    revisionBefore: input.receipt.revisionBefore,
    revisionAfter: input.receipt.revisionAfter,
    receipt: structuredClone(input.receipt),
    publishedAt: Date.now(),
  }
}
