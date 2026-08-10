import { createLogger } from '@freecut/shared/logging/logger'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { projectAiEditingRunsPath } from './paths'
import { requireWorkspaceRoot } from './root'

const logger = createLogger('WorkspaceFS:AiEditingRuns')
const VERSION = 1
const MAX_RUNS = 50

export interface AiEditingRunRecord {
  id: string
  createdAt: number
  request: string
  skillId?: string
  plan: string[]
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  toolCalls: Array<{ id: string; ok: boolean; message: string; details?: string[] }>
  completed: boolean
  completionNotes: string[]
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  updatedAt?: number
  phase?: string
  events?: AiEditingRunEvent[]
  production?: { blueprint: unknown; review: unknown }
}

export interface AiEditingRunEvent {
  at: number
  type: string
  message: string
  data?: unknown
}

interface AiEditingRunsFile {
  version: typeof VERSION
  runs: AiEditingRunRecord[]
}

function sanitizeRecord(value: unknown): AiEditingRunRecord | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingRunRecord>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.createdAt !== 'number' ||
    typeof candidate.request !== 'string' ||
    typeof candidate.timelineRevisionBefore !== 'number' ||
    typeof candidate.timelineRevisionAfter !== 'number' ||
    typeof candidate.completed !== 'boolean' ||
    !Array.isArray(candidate.plan) ||
    !Array.isArray(candidate.toolCalls) ||
    !Array.isArray(candidate.completionNotes)
  ) return null
  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    request: candidate.request,
    ...(typeof candidate.skillId === 'string' ? { skillId: candidate.skillId } : {}),
    plan: candidate.plan.filter((entry): entry is string => typeof entry === 'string').slice(0, 12),
    timelineRevisionBefore: candidate.timelineRevisionBefore,
    timelineRevisionAfter: candidate.timelineRevisionAfter,
    toolCalls: candidate.toolCalls.flatMap((entry) => entry && typeof entry === 'object' &&
      typeof (entry as { id?: unknown }).id === 'string' &&
      typeof (entry as { ok?: unknown }).ok === 'boolean' &&
      typeof (entry as { message?: unknown }).message === 'string'
      ? [{
          id: (entry as { id: string }).id,
          ok: (entry as { ok: boolean }).ok,
          message: (entry as { message: string }).message,
          ...(Array.isArray((entry as { details?: unknown }).details)
            ? {
                details: (entry as { details: unknown[] }).details
                  .filter((detail): detail is string => typeof detail === 'string')
                  .slice(0, 8),
              }
            : {}),
        }]
      : [],
    ).slice(0, 64),
    completed: candidate.completed,
    completionNotes: candidate.completionNotes.filter((entry): entry is string => typeof entry === 'string').slice(0, 12),
    ...(candidate.status === 'running' || candidate.status === 'completed' ||
      candidate.status === 'failed' || candidate.status === 'cancelled'
      ? { status: candidate.status }
      : {}),
    ...(typeof candidate.updatedAt === 'number' ? { updatedAt: candidate.updatedAt } : {}),
    ...(typeof candidate.phase === 'string' ? { phase: candidate.phase } : {}),
    ...(Array.isArray(candidate.events)
      ? {
          events: candidate.events.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return []
            const event = entry as Partial<AiEditingRunEvent>
            if (typeof event.at !== 'number' || typeof event.type !== 'string' ||
              typeof event.message !== 'string') return []
            return [{
              at: event.at,
              type: event.type,
              message: event.message,
              ...('data' in event ? { data: event.data } : {}),
            }]
          }),
        }
      : {}),
    ...(candidate.production && typeof candidate.production === 'object' && !Array.isArray(candidate.production)
      ? { production: candidate.production as { blueprint: unknown; review: unknown } }
      : {}),
  }
}

export async function saveAiEditingRun(projectId: string, record: AiEditingRunRecord): Promise<void> {
  try {
    const current = await readJson<AiEditingRunsFile>(requireWorkspaceRoot(), projectAiEditingRunsPath(projectId))
    const runs = current?.version === VERSION && Array.isArray(current.runs)
      ? current.runs.map(sanitizeRecord).filter((entry): entry is AiEditingRunRecord => entry !== null)
      : []
    const nextRecord = sanitizeRecord(record)
    if (!nextRecord) throw new Error('Invalid AI editing run record')
    await writeJsonAtomic(requireWorkspaceRoot(), projectAiEditingRunsPath(projectId), {
      version: VERSION,
      runs: [...runs.filter((entry) => entry.id !== record.id), nextRecord].slice(-MAX_RUNS),
    })
  } catch (error) {
    logger.error(`saveAiEditingRun(${projectId}) failed`, error)
    throw new Error('Failed to save AI editing run')
  }
}
