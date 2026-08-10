import {
  saveAiEditingRun,
  type AiEditingRunEvent,
  type AiEditingRunRecord,
} from '@freecut/infrastructure/storage'
import { createLogger } from '@freecut/shared/logging/logger'
import { enqueueAiEditingConversationWrite } from './conversation-writes'
import type { AiEditingRunResult, AiEditingTraceEvent } from './run-types'

const logger = createLogger('AiEditingRunRecorder')

function toolCalls(result: AiEditingRunResult): AiEditingRunRecord['toolCalls'] {
  return result.observations.map((observation) => ({
    id: observation.toolId,
    ok: observation.result.ok,
    message: observation.result.message,
    ...(observation.result.data &&
      typeof observation.result.data === 'object' &&
      Array.isArray((observation.result.data as { validationIssues?: unknown }).validationIssues)
      ? {
          details: (observation.result.data as { validationIssues: unknown[] }).validationIssues
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, 8),
        }
      : {}),
  }))
}

export interface AiEditingRunRecorder {
  start(): Promise<void>
  trace(event: AiEditingTraceEvent): void
  complete(result: AiEditingRunResult): Promise<void>
  fail(error: unknown, phase?: string): Promise<void>
  cancel(): Promise<void>
}

export function createAiEditingRunRecorder(input: {
  id: string
  projectId: string
  request: string
  timelineRevisionBefore: number
}): AiEditingRunRecorder {
  let events: AiEditingRunEvent[] = []
  let record: AiEditingRunRecord = {
    id: input.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    request: input.request,
    plan: [],
    timelineRevisionBefore: input.timelineRevisionBefore,
    timelineRevisionAfter: input.timelineRevisionBefore,
    toolCalls: [],
    completed: false,
    completionNotes: [],
    status: 'running',
    phase: 'queued',
    events,
  }

  const persist = (): Promise<void> => {
    const snapshot: AiEditingRunRecord = { ...record, events: [...events] }
    return enqueueAiEditingConversationWrite(input.projectId, () =>
      saveAiEditingRun(input.projectId, snapshot))
  }

  const append = (event: AiEditingTraceEvent): void => {
    events = [...events, {
      at: Date.now(),
      type: event.type,
      message: event.message,
      ...('data' in event ? { data: event.data } : {}),
    }]
    const data = event.data
    const resultData = data && typeof data === 'object'
      ? (data as { result?: { data?: { revisionAfter?: unknown } } }).result?.data
      : undefined
    const revisionAfter = typeof resultData?.revisionAfter === 'number'
      ? resultData.revisionAfter
      : record.timelineRevisionAfter
    record = {
      ...record,
      updatedAt: Date.now(),
      phase: event.type,
      timelineRevisionAfter: revisionAfter,
      events,
    }
  }

  return {
    async start() {
      append({ type: 'queued', message: '用户请求已进入剪辑执行队列。' })
      await persist()
    },
    trace(event) {
      append(event)
      void persist().catch((error) => logger.warn('Failed to persist AI editing trace event', error))
    },
    async complete(result) {
      append({
        type: result.completed ? 'completed' : 'incomplete',
        message: result.reply,
        data: { completionNotes: result.completionNotes },
      })
      record = {
        ...record,
        ...(result.skillId ? { skillId: result.skillId } : {}),
        plan: result.plan,
        timelineRevisionBefore: result.timelineRevisionBefore,
        timelineRevisionAfter: result.timelineRevisionAfter,
        toolCalls: toolCalls(result),
        completed: result.completed,
        completionNotes: result.completionNotes,
        status: result.completed ? 'completed' : 'failed',
        ...(result.production ? { production: result.production } : {}),
      }
      await persist()
    },
    async fail(error, phase = 'failed') {
      const message = error instanceof Error ? error.message : String(error)
      append({ type: 'failed', message, data: { phase } })
      record = {
        ...record,
        timelineRevisionAfter: record.timelineRevisionAfter,
        completed: false,
        completionNotes: [message],
        status: 'failed',
        phase,
      }
      await persist()
    },
    async cancel() {
      append({ type: 'cancelled', message: '用户停止了本次剪辑任务。' })
      record = {
        ...record,
        completed: false,
        completionNotes: ['用户停止了本次剪辑任务。'],
        status: 'cancelled',
        phase: 'cancelled',
      }
      await persist()
    },
  }
}
