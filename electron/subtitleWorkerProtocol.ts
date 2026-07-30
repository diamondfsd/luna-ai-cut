import { randomUUID } from 'node:crypto'
import { simplifyChineseText } from '../src/shared/subtitleTrack.ts'
import type { WorkspaceSubtitleCue } from '../src/shared/types'

export type SubtitleWorkerEvent =
  | { version: 1; type: 'ready'; modelLoadMs: number; gpu: boolean }
  | { version: 1; type: 'progress'; processedMs: number; totalMs: number }
  | { version: 1; type: 'segment'; startMs: number; endMs: number; text: string }
  | { version: 1; type: 'complete'; language: string; audioMs: number; inferenceMs: number; segmentCount: number }

export function parseSubtitleWorkerEvent(line: string): SubtitleWorkerEvent {
  const value = JSON.parse(line) as Partial<SubtitleWorkerEvent>
  if (value.version !== 1 || typeof value.type !== 'string') throw new Error('字幕识别进程返回了不兼容的数据')
  if (value.type === 'ready' && Number.isFinite(value.modelLoadMs) && typeof value.gpu === 'boolean') return value as SubtitleWorkerEvent
  if (value.type === 'progress' && Number.isFinite(value.processedMs) && Number.isFinite(value.totalMs)) return value as SubtitleWorkerEvent
  if (value.type === 'segment' && Number.isFinite(value.startMs) && Number.isFinite(value.endMs) && typeof value.text === 'string') return value as SubtitleWorkerEvent
  if (value.type === 'complete' && typeof value.language === 'string' && Number.isFinite(value.audioMs) && Number.isFinite(value.inferenceMs) && Number.isFinite(value.segmentCount)) return value as SubtitleWorkerEvent
  throw new Error('字幕识别进程返回了无效数据')
}

export function subtitleCueFromWorker(event: Extract<SubtitleWorkerEvent, { type: 'segment' }>): WorkspaceSubtitleCue | null {
  const text = event.text.trim()
  const startMs = Math.max(0, Math.round(event.startMs))
  const endMs = Math.max(startMs + 10, Math.round(event.endMs))
  if (!text) return null
  return { id: randomUUID(), startMs, endMs, text, source: 'generated' }
}

export function normalizeSubtitleCuesLanguage(
  cues: WorkspaceSubtitleCue[],
  language: string,
): WorkspaceSubtitleCue[] {
  if (!language.toLowerCase().startsWith('zh')) return cues
  return cues.map((cue) => ({ ...cue, text: simplifyChineseText(cue.text) }))
}
