import type { LlmRequestStatus } from '@freecut/infrastructure/llm'
import type { AiEditingRunOptions } from './run-types'

export function traceRun(
  options: AiEditingRunOptions,
  type: string,
  message: string,
  data?: unknown,
): void {
  options.onTraceEvent?.({ type, message, ...(data === undefined ? {} : { data }) })
}

export function reportRunProgress(
  options: AiEditingRunOptions,
  label: string,
  percent: number,
  ceiling?: number,
  reasoningText?: string | null,
): void {
  options.onRunProgress?.({
    label,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    ...(ceiling === undefined
      ? {}
      : { ceiling: Math.max(percent, Math.min(100, Math.round(ceiling))) }),
    ...(reasoningText === undefined ? {} : { reasoningText }),
  })
}

export function reportModelRequestStatus(
  options: AiEditingRunOptions,
  status: LlmRequestStatus,
  percent: number,
): void {
  const attemptLabel =
    status.state === 'retrying' || status.attempt > 1
      ? `（第 ${status.attempt}/${status.maxAttempts} 次）`
      : ''
  const label = `思考中${attemptLabel}`
  const reasoningText =
    status.state === 'streaming' && status.previewKind === 'reasoning'
      ? status.previewText ?? ''
      : null
  reportRunProgress(options, label, percent, Math.max(percent, 68), reasoningText)
}
