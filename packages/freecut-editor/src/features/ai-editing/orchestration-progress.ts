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
  previewText?: string,
): void {
  options.onRunProgress?.({
    label,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    ...(ceiling === undefined
      ? {}
      : { ceiling: Math.max(percent, Math.min(100, Math.round(ceiling))) }),
    ...(previewText === undefined ? {} : { previewText }),
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
  const label =
    status.state === 'streaming'
      ? `${status.previewKind === 'reasoning' ? '正在整理剪辑思路' : '正在生成剪辑方案'}${attemptLabel}`
      : status.state === 'retrying' || status.attempt > 1
        ? `正在重新尝试获取剪辑方案${attemptLabel}`
        : '正在等待剪辑方案'
  reportRunProgress(options, label, percent, Math.max(percent, 68), status.previewText)
}
