import type { LlmAdapter, LlmMessage, LlmRequestStatus } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import {
  openAiChatCompletionsLlmAdapter,
  supportsNativeToolCalling,
  type NativeToolCallingLlmAdapter,
} from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
import { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store-facade'
import {
  getEmbeddedHostBridge,
  type EmbeddedAiAssistantMessage,
  type EmbeddedAiAssistantToolCall,
  type EmbeddedAiAssistantToolDefinition,
} from '@freecut/shared/host/embedded-host'
import { buildAiEditingSystemPrompt } from './agent-prompt'
import { getTimelineRevision } from './evidence'
import { buildAgentWorkspaceDocument } from './workspace-document/build-workspace-document'
import type { AgentWorkspaceDocument } from './edit-program/types'
import { parseAiEditingResponse } from './response-parser'
import { latestFailedEdit } from './latest-edit-result'
import fallbackProgressPrompt from './prompts/messages/fallback-progress.md?raw'
import invalidJsonPrompt from './prompts/messages/invalid-json.md?raw'
import nativeContinuePrompt from './prompts/messages/native-continue.md?raw'
import toolResultsPrompt from './prompts/messages/tool-results.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { getAiEditingTool, listAiEditingTools } from './tool-registry'
import type { AiEditingObservation, AiEditingToolCall, AiEditingToolResult } from './types'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'

const MAX_TOOL_ROUNDS = 8
const MAX_TOKENS = 4_096
const MAX_TOOL_RESULT_CHARS = 8_000

interface NativeToolCatalog {
  definitions: EmbeddedAiAssistantToolDefinition[]
  idsByFunctionName: Map<string, string>
}

function nativeFunctionName(toolId: string): string {
  return `fc_${toolId.replaceAll('.', '_')}`
}

function createNativeToolCatalog(): NativeToolCatalog {
  const idsByFunctionName = new Map<string, string>()
  const definitions = listAiEditingTools().map((tool) => {
    // Chat Completions function names cannot contain the dots used by editor tool IDs.
    const name = nativeFunctionName(tool.id)
    if (idsByFunctionName.has(name)) throw new Error('剪辑助手工具名称重复，无法继续。')
    idsByFunctionName.set(name, tool.id)
    return {
      name,
      description: `${tool.title}。${tool.description}`,
      parameters: tool.inputSchema,
    }
  })
  return { definitions, idsByFunctionName }
}

function toolError(toolId: string, message: string): AiEditingObservation {
  return { toolId, result: { ok: false, message } }
}

function serializeForModel(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…` : text
}

async function yieldForUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function saveTimelineAfterEdit(): Promise<void> {
  const timeline = useTimelineStore.getState()
  if (!timeline.isDirty) return
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前项目不可用，无法保存剪辑结果。')
  await timeline.saveTimeline(projectId)
}

async function currentWorkspace(options: AiEditingRunOptions): Promise<AgentWorkspaceDocument> {
  const workspace = await buildAgentWorkspaceDocument()
  return options.scopeWorkspace?.(workspace) ?? workspace
}

function reportRunProgress(
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

function reportModelRequestStatus(
  options: AiEditingRunOptions,
  status: LlmRequestStatus,
  percent: number,
): void {
  const label = status.state === 'streaming'
    ? `${status.previewKind === 'reasoning' ? '正在整理剪辑思路' : '正在生成剪辑方案'}（第 ${status.attempt}/${status.maxAttempts} 次）`
    : status.state === 'retrying' || status.attempt > 1
      ? `正在重新尝试获取剪辑方案（第 ${status.attempt}/${status.maxAttempts} 次）`
      : `正在等待剪辑方案（第 ${status.attempt}/${status.maxAttempts} 次）`
  reportRunProgress(options, label, percent, Math.max(percent, 68), status.previewText)
}

export function getAiEditingAdapter(): LlmAdapter {
  if (getEmbeddedHostBridge().aiAssistant) return openAiChatCompletionsLlmAdapter
  return getDefaultLlmAdapter()
}

async function executeToolCall(
  call: AiEditingToolCall,
  callIndex: number,
  options: AiEditingRunOptions,
): Promise<AiEditingObservation> {
  const tool = getAiEditingTool(call.id)
  if (!tool) return toolError(call.id, '这个操作目前不可用。')

  const validation = tool.validate(call.args)
  if (!validation.ok) return toolError(tool.id, validation.error)

  const activityId = `${options.activityScope ?? 'turn'}-${callIndex}-${tool.id}`
  const tracksProgress = tool.execution === 'async' || tool.risk === 'analysis'
  options.onToolActivity?.({
    id: activityId,
    toolId: tool.id,
    title: tool.title,
    status: 'running',
    ...(tracksProgress
      ? { progressLabel: `正在${tool.title}`, progressPercent: null }
      : {}),
  })
  await yieldForUi()

  const reportProgress = (progress: { label: string; percent: number | null }): void => {
    const percent = progress.percent === null
      ? null
      : Math.max(0, Math.min(100, Math.round(progress.percent)))
    options.onToolActivity?.({
      id: activityId,
      toolId: tool.id,
      title: tool.title,
      status: 'running',
      progressLabel: progress.label,
      progressPercent: percent,
    })
  }

  let result: AiEditingToolResult
  try {
    if (tool.risk === 'edit' && tool.execution === 'sync') {
      result = useTimelineCommandStore.getState().executeTransaction(
        { type: 'AI_EDITING_TOOL', payload: { toolId: tool.id } },
        () => {
          const execution = tool.execute(validation.value, {
            signal: options.signal,
            reportProgress,
          })
          if (execution instanceof Promise) throw new Error('剪辑操作未能及时完成。')
          return execution
        },
      )
    } else {
      result = await tool.execute(validation.value, {
        signal: options.signal,
        reportProgress,
      })
    }
    if (result.ok && tool.risk === 'edit') await saveTimelineAfterEdit()
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : '操作未能完成。' }
  }

  options.onToolActivity?.({
    id: activityId,
    toolId: tool.id,
    title: tool.title,
    status: result.ok ? 'succeeded' : 'failed',
    message: result.message,
    ...(tracksProgress && result.ok
      ? { progressLabel: `${tool.title}已完成`, progressPercent: 100 }
      : {}),
  })
  return { toolId: tool.id, result }
}

function defaultReply(observations: AiEditingObservation[]): string {
  const edited = observations.some((observation) =>
    observation.result.ok && getAiEditingTool(observation.toolId)?.risk === 'edit')
  if (edited) return '已执行时间轴修改，请继续检查当前结果。'
  return observations.length > 0 ? '已读取当前项目，但还没有完成实际修改。' : '尚未执行项目操作。'
}

function toNativeMessages(messages: LlmMessage[]): EmbeddedAiAssistantMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }))
}

function parseNativeArguments(argumentsText: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(argumentsText) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function executeNativeToolCall(
  call: EmbeddedAiAssistantToolCall,
  toolIdsByFunctionName: Map<string, string>,
  callIndex: number,
  options: AiEditingRunOptions,
): Promise<AiEditingObservation> {
  const toolId = toolIdsByFunctionName.get(call.name)
  if (!toolId) return toolError(call.name, '这个操作目前不可用。')
  const args = parseNativeArguments(call.arguments)
  if (!args) return toolError(toolId, '操作参数无效，未执行此操作。')
  return executeToolCall({ id: toolId, args }, callIndex, options)
}

async function buildInitialMessages(
  userText: string,
  history: LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
): Promise<LlmMessage[]> {
  return [
    { role: 'system', content: await buildAiEditingSystemPrompt(evidence, protocol, userText) },
    ...history.slice(-6),
    { role: 'user', content: userText },
  ]
}

async function buildJsonFallbackMessages(
  userText: string,
  history: LlmMessage[],
  observations: AiEditingObservation[],
  options: AiEditingRunOptions,
): Promise<LlmMessage[]> {
  const messages = await buildInitialMessages(userText, history, await currentWorkspace(options), 'json')
  if (observations.length > 0) {
    messages.push({
      role: 'user',
      content: renderPrompt(fallbackProgressPrompt, { OBSERVATIONS: serializeForModel(observations) }),
    })
  }
  return messages
}

async function runJsonToolLoop(
  messages: LlmMessage[],
  options: AiEditingRunOptions,
  adapter: LlmAdapter,
  initialRaw?: string,
  maxRounds = MAX_TOOL_ROUNDS,
): Promise<AiEditingRunResult> {
  const observations: AiEditingObservation[] = []
  let reply = ''
  let callIndex = 0
  let rawFromPreviousRequest = initialRaw
  let finished = false

  for (let round = 0; round < maxRounds; round += 1) {
    reportRunProgress(
      options,
      round === 0 ? '正在理解需求并规划剪辑' : '正在根据执行结果继续规划',
      round === 0 ? 32 : Math.min(88, 70 + round * 3),
      round === 0 ? 68 : Math.min(92, 82 + round * 2),
    )
    const raw = rawFromPreviousRequest ?? await adapter.generate(messages, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
      onToken: options.onToken,
      onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
    })
    rawFromPreviousRequest = undefined
    reportRunProgress(options, '正在检查剪辑方案', round === 0 ? 72 : Math.min(94, 84 + round * 2))
    const parsed = parseAiEditingResponse(raw)
    if (!parsed) {
      if (round === maxRounds - 1) {
        throw new Error('助手这次没有按约定返回剪辑操作，已自动重试多次。请再试一次。')
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: invalidJsonPrompt.trim() })
      continue
    }

    reply = parsed.reply || reply
    if (parsed.toolCalls.length === 0) {
      reportRunProgress(options, '剪辑方案已确认', 96)
      finished = true
      break
    }

    const roundObservations: AiEditingObservation[] = []
    for (const call of parsed.toolCalls.slice(0, 3)) {
      if (options.signal?.aborted) break
      const observation = await executeToolCall(call, callIndex, options)
      callIndex += 1
      roundObservations.push(observation)
      observations.push(observation)
    }
    if (options.signal?.aborted) break

    messages.push({ role: 'assistant', content: raw })
    messages.push({
      role: 'user',
      content: renderPrompt(toolResultsPrompt, {
        OBSERVATIONS: serializeForModel(roundObservations),
        PROJECT_EVIDENCE: JSON.stringify(await currentWorkspace(options)),
      }),
    })
  }

  return {
    reply: reply || defaultReply(observations),
    observations,
    plan: [],
    completed: finished && !options.signal?.aborted,
    completionNotes: finished ? [] : ['本轮没有在操作上限内完成用户目标。'],
    timelineRevisionBefore: 0,
    timelineRevisionAfter: 0,
  }
}

async function runNativeToolLoop(
  messages: EmbeddedAiAssistantMessage[],
  userText: string,
  options: AiEditingRunOptions,
  adapter: NativeToolCallingLlmAdapter,
  maxRounds = MAX_TOOL_ROUNDS,
): Promise<AiEditingRunResult> {
  const catalog = createNativeToolCatalog()
  const observations: AiEditingObservation[] = []
  let reply = ''
  let callIndex = 0
  let finished = false

  for (let round = 0; round < maxRounds; round += 1) {
    reportRunProgress(
      options,
      round === 0 ? '正在理解需求并规划剪辑' : '正在根据执行结果继续规划',
      round === 0 ? 32 : Math.min(88, 70 + round * 3),
      round === 0 ? 68 : Math.min(92, 82 + round * 2),
    )
    const response = await adapter.generateWithTools(messages, catalog.definitions, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
      onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
    })
    if (response.mode === 'fallback') {
      return runJsonToolLoop(
        await buildJsonFallbackMessages(userText, options.history, observations, options),
        options,
        adapter,
        undefined,
        maxRounds,
      )
    }
    if (response.mode === 'json') {
      return runJsonToolLoop(
        await buildJsonFallbackMessages(userText, options.history, observations, options),
        options,
        adapter,
        response.content,
        maxRounds,
      )
    }

    reportRunProgress(options, '正在检查剪辑方案', round === 0 ? 72 : Math.min(94, 84 + round * 2))
    if (response.content) reply = response.content
    if (response.toolCalls.length === 0) {
      if (response.content) options.onToken?.(response.content, response.content)
      reportRunProgress(options, '剪辑方案已确认', 96)
      finished = true
      break
    }

    const roundObservations: Array<{ call: EmbeddedAiAssistantToolCall; observation: AiEditingObservation }> = []
    for (const call of response.toolCalls) {
      if (options.signal?.aborted) break
      const observation = await executeNativeToolCall(call, catalog.idsByFunctionName, callIndex, options)
      callIndex += 1
      observations.push(observation)
      roundObservations.push({ call, observation })
    }
    if (options.signal?.aborted) break

    messages.push({
      role: 'assistant',
      ...(response.content ? { content: response.content } : {}),
      toolCalls: response.toolCalls,
    })
    for (const { call, observation } of roundObservations) {
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: serializeForModel(observation),
      })
    }
    messages.push({
      role: 'user',
      content: renderPrompt(nativeContinuePrompt, {
        PROJECT_EVIDENCE: JSON.stringify(await currentWorkspace(options)),
      }),
    })
  }

  return {
    reply: reply || defaultReply(observations),
    observations,
    plan: [],
    completed: finished && !options.signal?.aborted,
    completionNotes: finished ? [] : ['本轮没有在操作上限内完成用户目标。'],
    timelineRevisionBefore: 0,
    timelineRevisionAfter: 0,
  }
}

export async function runSingleAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
  config: { evidence?: unknown; maxToolRounds?: number } = {},
): Promise<AiEditingRunResult> {
  const adapter = options.adapter ?? getAiEditingAdapter()
  reportRunProgress(options, '正在读取当前编辑空间', 6)
  const evidence = config.evidence ?? await buildAgentWorkspaceDocument()
  reportRunProgress(options, '正在整理轨道、素材和上下文', 18)
  const timelineRevisionBefore = getTimelineRevision()
  let result: AiEditingRunResult
  if (supportsNativeToolCalling(adapter)) {
    reportRunProgress(options, '正在准备剪辑需求', 26)
    result = await runNativeToolLoop(
      toNativeMessages(await buildInitialMessages(userText, options.history, evidence, 'native')),
      userText,
      options,
      adapter,
      config.maxToolRounds,
    )
  } else {
    reportRunProgress(options, '正在准备剪辑需求', 26)
    result = await runJsonToolLoop(
      await buildInitialMessages(userText, options.history, evidence, 'json'),
      options,
      adapter,
      undefined,
      config.maxToolRounds,
    )
  }
  const failedEdit = latestFailedEdit(result.observations)
  return {
    ...result,
    ...(failedEdit
      ? { reply: `编辑程序没有提交：${failedEdit.result.message}` }
      : !result.completed
        ? { reply: '本轮达到操作上限，尚未确认完成用户目标。请继续提出调整，助手会基于当前项目接着处理。' }
      : {}),
    plan: result.observations.map((entry) => entry.toolId),
    completed: !failedEdit && result.completed,
    completionNotes: failedEdit
      ? [failedEdit.result.message]
      : result.completionNotes,
    timelineRevisionBefore,
    timelineRevisionAfter: getTimelineRevision(),
  }
}
