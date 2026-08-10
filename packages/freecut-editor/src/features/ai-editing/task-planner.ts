import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { AgentWorkspaceDocument } from './edit-program/types'
import type { AiEditingTask, AiEditingTaskKind } from './types'

const MAX_TASKS = 12
const MAX_PLANNER_EVIDENCE_CHARS = 24_000
const COMPLEX_INTENT = /(整体|全部|完整|成片|按方案|制作视频|脚本|分镜|镜头|shot)/i
const TASK_KINDS = new Set<AiEditingTaskKind>(['analyze', 'edit', 'review'])

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function plannerJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, max) : null
}

export function parseAiEditingTaskPlan(
  raw: string,
  workspace: AgentWorkspaceDocument,
): AiEditingTask[] {
  const root = plainObject(plannerJson(raw))
  if (!root || !Array.isArray(root.tasks)) return []
  const knownMedia = new Set<string>(workspace.media.map((entry) => entry.ref))
  const duration = Math.max(0, workspace.project.duration)
  const tasks: AiEditingTask[] = []

  for (const candidate of root.tasks.slice(0, MAX_TASKS)) {
    const value = plainObject(candidate)
    const title = boundedText(value?.title, 80)
    const instruction = boundedText(value?.instruction, 600)
    const kind = value?.kind
    if (!value || !title || !instruction || typeof kind !== 'string' || !TASK_KINDS.has(kind as AiEditingTaskKind)) {
      continue
    }
    const rangeValue = plainObject(value.range)
    const start = typeof rangeValue?.start === 'number' && Number.isFinite(rangeValue.start)
      ? Math.max(0, rangeValue.start)
      : null
    const rawEnd = typeof rangeValue?.end === 'number' && Number.isFinite(rangeValue.end)
      ? rangeValue.end
      : null
    const end = rawEnd === null ? null : duration > 0 ? Math.min(duration, rawEnd) : rawEnd
    const mediaRefs = Array.isArray(value.mediaRefs)
      ? [...new Set(value.mediaRefs.filter((ref): ref is string => typeof ref === 'string' && knownMedia.has(ref)))].slice(0, 12)
      : []
    tasks.push({
      id: `task-${tasks.length + 1}`,
      title,
      instruction,
      kind: kind as AiEditingTaskKind,
      ...(start !== null && end !== null && end > start ? { range: { start, end } } : {}),
      ...(mediaRefs.length > 0 ? { mediaRefs } : {}),
    })
  }
  return tasks
}

export function shouldUseAiEditingTaskMode(
  userText: string,
  workspace: AgentWorkspaceDocument,
): boolean {
  return COMPLEX_INTENT.test(userText)
    || workspace.media.length >= 3
    || workspace.clips.length >= 8
    || workspace.project.duration > 45
}

function compactPlanningEvidence(workspace: AgentWorkspaceDocument): string {
  const compact = {
    project: workspace.project,
    media: workspace.media.slice(0, 30).map((entry) => ({
      ref: entry.ref,
      name: entry.name,
      kind: entry.kind,
      duration: entry.duration,
      visual: entry.evidence.visual.slice(0, 3),
      transcript: entry.evidence.transcript
        ? { ...entry.evidence.transcript, excerpt: entry.evidence.transcript.excerpt.slice(0, 4) }
        : undefined,
    })),
    tracks: workspace.tracks,
    clips: workspace.clips.slice(0, 80).map((entry) => ({
      ref: entry.ref,
      label: entry.label,
      type: entry.type,
      trackRef: entry.trackRef,
      start: entry.start,
      duration: entry.duration,
      mediaRef: entry.mediaRef,
    })),
  }
  return JSON.stringify(compact).slice(0, MAX_PLANNER_EVIDENCE_CHARS)
}

export function buildAiEditingPlannerMessages(
  userText: string,
  history: LlmMessage[],
  workspace: AgentWorkspaceDocument,
): LlmMessage[] {
  return [
    {
      role: 'system',
      content: `你是剪辑任务规划器。把复杂目标拆成 1-${MAX_TASKS} 个可独立完成的有序任务，每个任务只负责一个镜头、时间段或明确阶段。分析、编辑和复查应分开；不要执行剪辑，也不要输出解释。只返回 JSON：{"tasks":[{"title":"...","instruction":"...","kind":"analyze|edit|review","range":{"start":0,"end":5},"mediaRefs":["media:..."]}]}。range 和 mediaRefs 可省略，只能使用证据中存在的素材引用。\n项目证据：${compactPlanningEvidence(workspace)}`,
    },
    ...history.slice(-4),
    { role: 'user', content: userText },
  ]
}

export async function planAiEditingTasks(
  userText: string,
  history: LlmMessage[],
  workspace: AgentWorkspaceDocument,
  adapter: LlmAdapter,
  options: { signal?: AbortSignal; onToken?: (delta: string, text: string) => void },
): Promise<AiEditingTask[]> {
  const raw = await adapter.generate(buildAiEditingPlannerMessages(userText, history, workspace), {
    maxTokens: 1_400,
    temperature: 0,
    reasoningEffort: 'low',
    signal: options.signal,
    onToken: options.onToken,
  })
  const tasks = parseAiEditingTaskPlan(raw, workspace)
  if (tasks.length === 0) throw new Error('没有生成可执行的剪辑步骤，请换一种说法再试。')
  return tasks
}

function overlaps(start: number, duration: number, range: { start: number; end: number }): boolean {
  return start < range.end && start + duration > range.start
}

export function scopeWorkspaceForTask(
  workspace: AgentWorkspaceDocument,
  task: AiEditingTask,
): AgentWorkspaceDocument {
  const requestedMedia = new Set(task.mediaRefs ?? [])
  const clips = workspace.clips.filter((clip) =>
    (!task.range || overlaps(clip.start, clip.duration, task.range))
    && (requestedMedia.size === 0 || (clip.mediaRef && requestedMedia.has(clip.mediaRef))),
  )
  const includedMedia = new Set([
    ...requestedMedia,
    ...clips.flatMap((clip) => clip.mediaRef ? [clip.mediaRef] : []),
  ])
  const includedTracks = new Set(clips.map((clip) => clip.trackRef))
  const includedClips = new Set(clips.map((clip) => clip.ref))
  return {
    ...workspace,
    viewport: {
      ...workspace.viewport,
      selectedClipRefs: workspace.viewport.selectedClipRefs.filter((ref) => includedClips.has(ref)),
    },
    media: includedMedia.size > 0
      ? workspace.media.filter((entry) => includedMedia.has(entry.ref))
      : workspace.media,
    tracks: includedTracks.size > 0
      ? workspace.tracks.filter((entry) => includedTracks.has(entry.ref))
      : workspace.tracks,
    clips,
    transitions: workspace.transitions.filter((entry) =>
      includedClips.has(entry.between[0]) && includedClips.has(entry.between[1])),
  }
}

export function buildAiEditingTaskInstruction(
  goal: string,
  task: AiEditingTask,
  index: number,
  total: number,
  completedSummaries: string[],
): string {
  return [
    `总目标：${goal}`,
    `当前任务（${index + 1}/${total}）：${task.title}`,
    `任务说明：${task.instruction}`,
    task.range ? `处理范围：${task.range.start}-${task.range.end} 秒` : '',
    completedSummaries.length > 0 ? `已完成：${completedSummaries.join('；')}` : '',
    '只完成当前任务，不要提前执行后续任务。完成后用一句话说明结果，不输出内部思考过程。',
  ].filter(Boolean).join('\n')
}
