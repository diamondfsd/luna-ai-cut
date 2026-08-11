import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import {
  openAiChatCompletionsLlmAdapter,
  supportsNativeToolCalling,
  type NativeToolCallingLlmAdapter,
} from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import {
  getEmbeddedHostBridge,
  type EmbeddedAiAssistantMessage,
  type EmbeddedAiAssistantToolCall,
} from '@freecut/shared/host/embedded-host'
import {
  clearTimelineCodingSession,
  startTimelineCodingSession,
} from './coding-workspace/session-registry'
import { getTimelineRevision } from './evidence'
import { failedEditMessage, latestFailedEdit } from './latest-edit-result'
import { createNativeToolCatalog } from './native-tool-catalog'
import {
  buildInitialMessages,
  buildJsonFallbackMessages,
  buildTurnSystemPrompt,
  currentWorkspace,
  isConfirmedPlanExecutionRequest,
  toNativeMessages,
} from './orchestration-messages'
import {
  reportModelRequestStatus,
  reportRunProgress,
  traceRun as trace,
} from './orchestration-progress'
import {
  declaredPlan,
  defaultReply,
  hasCommittedEdit,
  hasUnfinalizedEdit,
  hasUnpublishedSourceWork,
} from './orchestration-results'
import invalidJsonPrompt from './prompts/messages/invalid-json.md?raw'
import pendingWorkPrompt from './prompts/messages/missing-finish.md?raw'
import nativeContinuePrompt from './prompts/messages/native-continue.md?raw'
import toolResultsPrompt from './prompts/messages/tool-results.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { parseAiEditingResponse } from './response-parser'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'
import { executeNativeToolCall, executeToolCall, serializeForModel } from './tool-execution'
import type { AiEditingObservation } from './types'

const MAX_TOOL_ROUNDS = 20
const MAX_TOOL_CALLS_PER_ROUND = 8
const MAX_TOKENS = 8_192

function isDeferredTextReply(reply: string): boolean {
  const text = reply.trim()
  if (text.length >= 120) return false
  return /(我来帮你|我会帮你|接下来.{0,12}(给你|提供)|直接给你.{0,12}(方案|脚本)|马上.{0,12}(开始|给你))/.test(text)
}

export function getAiEditingAdapter(): LlmAdapter {
  if (getEmbeddedHostBridge().aiAssistant) return openAiChatCompletionsLlmAdapter
  return getDefaultLlmAdapter()
}

function loopResult(input: {
  reply: string
  observations: AiEditingObservation[]
  completed: boolean
  completionNotes?: string[]
}): AiEditingRunResult {
  return {
    reply: input.reply,
    observations: input.observations,
    plan: [],
    completed: input.completed,
    completionNotes: input.completionNotes ?? [],
    timelineRevisionBefore: 0,
    timelineRevisionAfter: 0,
  }
}

function unfinishedResult(
  reply: string,
  observations: AiEditingObservation[],
  signal?: AbortSignal,
): AiEditingRunResult {
  const note = signal?.aborted
    ? '用户停止了本次处理。'
    : hasUnpublishedSourceWork(observations)
      ? '剪辑源码尚未成功发布到时间轴。'
      : hasUnfinalizedEdit(observations)
        ? '已发布当前阶段，但剪辑工程尚未最终提交。'
      : '本轮没有在操作上限内完成用户目标。'
  return loopResult({
    reply: reply || (signal?.aborted ? '已停止本次处理。' : defaultReply(observations)),
    observations,
    completed: false,
    completionNotes: [note],
  })
}

function completedEditResult(
  _reply: string,
  observations: AiEditingObservation[],
): AiEditingRunResult {
  return loopResult({
    reply: defaultReply(observations),
    observations,
    completed: true,
  })
}

async function runJsonToolLoop(
  messages: LlmMessage[],
  userText: string,
  options: AiEditingRunOptions,
  adapter: LlmAdapter,
  initialRaw?: string,
  maxRounds = MAX_TOOL_ROUNDS,
  availableToolIds?: ReadonlySet<string>,
  initialObservations: readonly AiEditingObservation[] = [],
  requiresTimelineCommit = false,
): Promise<AiEditingRunResult> {
  const observations: AiEditingObservation[] = [...initialObservations]
  let reply = ''
  let callIndex = observations.length
  let rawFromPreviousRequest = initialRaw

  for (let round = 0; round < maxRounds; round += 1) {
    trace(options, 'model-request', `请求模型处理第 ${round + 1} 轮。`, {
      protocol: 'json',
      round: round + 1,
      messageCount: messages.length,
    })
    reportRunProgress(
      options,
      round === 0 ? '正在理解需求' : '正在根据执行结果继续处理',
      round === 0 ? 32 : Math.min(90, 68 + round * 2),
      round === 0 ? 68 : Math.min(94, 80 + round * 2),
    )
    let raw: string
    try {
      raw =
        rawFromPreviousRequest ??
        (await adapter.generate(messages, {
          maxTokens: MAX_TOKENS,
          temperature: 0,
          reasoningEffort: options.reasoningEffort,
          signal: options.signal,
          onToken: options.onToken,
          onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
        }))
    } catch (error) {
      trace(options, 'model-error', '模型请求失败。', {
        round: round + 1,
        error: error instanceof Error ? error.message : String(error),
      })
      if (!hasCommittedEdit(observations)) throw error
      return completedEditResult(reply, observations)
    }
    rawFromPreviousRequest = undefined
    trace(options, 'model-response', `模型返回第 ${round + 1} 轮结果。`, {
      protocol: 'json',
      round: round + 1,
      raw,
    })
    reportRunProgress(options, '正在检查处理结果', Math.min(95, 72 + round * 2))
    const parsed = parseAiEditingResponse(raw)
    if (!parsed) {
      trace(options, 'protocol-error', '模型返回内容无法解析为工具协议。', {
        round: round + 1,
      })
      if (round === maxRounds - 1) {
        throw new Error('助手这次没有按约定返回处理结果，已自动重试多次。请再试一次。')
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: invalidJsonPrompt.trim() })
      continue
    }

    reply = parsed.reply || reply
    if (parsed.toolCalls.length === 0) {
      if (
        !requiresTimelineCommit &&
        parsed.reply.trim() &&
        !isDeferredTextReply(parsed.reply) &&
        !hasUnpublishedSourceWork(observations) &&
        !hasUnfinalizedEdit(observations)
      ) {
        return loopResult({ reply: parsed.reply, observations, completed: true })
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: pendingWorkPrompt.trim() })
      continue
    }

    const roundObservations: AiEditingObservation[] = []
    for (const call of parsed.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND)) {
      if (options.signal?.aborted) break
      trace(options, 'tool-start', `开始执行工具 ${call.id}。`, {
        round: round + 1,
        toolId: call.id,
        arguments: call.args,
      })
      const observation = await executeToolCall(call, callIndex, options, availableToolIds)
      callIndex += 1
      observations.push(observation)
      roundObservations.push(observation)
      trace(options, 'tool-result', `工具 ${observation.toolId} 执行结束。`, {
        round: round + 1,
        toolId: observation.toolId,
        result: observation.result,
      })
      if (hasCommittedEdit(observations)) {
        reportRunProgress(options, '剪辑工程已发布', 96)
        return completedEditResult(reply, observations)
      }
    }
    if (options.signal?.aborted) break

    messages.push({ role: 'assistant', content: raw })
    messages[0] = {
      role: 'system',
      content: await buildTurnSystemPrompt(
        userText,
        options.history,
        await currentWorkspace(options),
        'json',
        availableToolIds,
      ),
    }
    messages.push({
      role: 'user',
      content: renderPrompt(toolResultsPrompt, {
        OBSERVATIONS: serializeForModel(roundObservations),
      }),
    })
  }

  return unfinishedResult(reply, observations, options.signal)
}

async function runNativeToolLoop(
  messages: EmbeddedAiAssistantMessage[],
  userText: string,
  options: AiEditingRunOptions,
  adapter: NativeToolCallingLlmAdapter,
  maxRounds = MAX_TOOL_ROUNDS,
  availableToolIds?: ReadonlySet<string>,
  requiresTimelineCommit = false,
): Promise<AiEditingRunResult> {
  const catalog = createNativeToolCatalog(availableToolIds)
  const observations: AiEditingObservation[] = []
  let reply = ''
  let callIndex = 0

  for (let round = 0; round < maxRounds; round += 1) {
    trace(options, 'model-request', `请求模型处理第 ${round + 1} 轮。`, {
      protocol: 'native',
      round: round + 1,
      messageCount: messages.length,
    })
    reportRunProgress(
      options,
      round === 0 ? '正在理解需求' : '正在根据执行结果继续处理',
      round === 0 ? 32 : Math.min(90, 68 + round * 2),
      round === 0 ? 68 : Math.min(94, 80 + round * 2),
    )
    let response
    try {
      response = await adapter.generateWithTools(messages, catalog.definitions, {
        maxTokens: MAX_TOKENS,
        temperature: 0,
        reasoningEffort: options.reasoningEffort,
        signal: options.signal,
        onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
      })
    } catch (error) {
      trace(options, 'model-error', '模型请求失败。', {
        round: round + 1,
        error: error instanceof Error ? error.message : String(error),
      })
      if (!hasCommittedEdit(observations)) throw error
      return completedEditResult(reply, observations)
    }
    trace(options, 'model-response', `模型返回第 ${round + 1} 轮结果。`, {
      protocol: 'native',
      round: round + 1,
      mode: response.mode,
      content: 'content' in response ? response.content : undefined,
      toolCalls: 'toolCalls' in response ? response.toolCalls : undefined,
    })
    if (response.mode === 'fallback' || response.mode === 'json') {
      const fallbackMessages = await buildJsonFallbackMessages(
        userText,
        options.history,
        observations,
        options,
        availableToolIds,
      )
      return runJsonToolLoop(
        fallbackMessages,
        userText,
        options,
        adapter,
        response.mode === 'json' ? response.content : undefined,
        maxRounds,
        availableToolIds,
        observations,
        requiresTimelineCommit,
      )
    }

    reportRunProgress(options, '正在检查处理结果', Math.min(95, 72 + round * 2))
    if (response.content) reply = response.content
    if (response.toolCalls.length === 0) {
      if (
        !requiresTimelineCommit &&
        response.content?.trim() &&
        !isDeferredTextReply(response.content) &&
        !hasUnpublishedSourceWork(observations) &&
        !hasUnfinalizedEdit(observations)
      ) {
        options.onToken?.(response.content, response.content)
        return loopResult({ reply: response.content, observations, completed: true })
      }
      messages.push({
        role: 'assistant',
        ...(response.content ? { content: response.content } : {}),
      })
      messages.push({ role: 'user', content: pendingWorkPrompt.trim() })
      continue
    }

    const selectedCalls = response.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND)
    const roundObservations: Array<{
      call: EmbeddedAiAssistantToolCall
      observation: AiEditingObservation
    }> = []
    for (const call of selectedCalls) {
      if (options.signal?.aborted) break
      const toolId = catalog.idsByFunctionName.get(call.name) ?? call.name
      trace(options, 'tool-start', `开始执行工具 ${toolId}。`, {
        round: round + 1,
        toolId,
        arguments: call.arguments,
      })
      const observation = await executeNativeToolCall(
        call,
        catalog.idsByFunctionName,
        callIndex,
        options,
        availableToolIds,
      )
      callIndex += 1
      observations.push(observation)
      roundObservations.push({ call, observation })
      trace(options, 'tool-result', `工具 ${observation.toolId} 执行结束。`, {
        round: round + 1,
        toolId: observation.toolId,
        result: observation.result,
      })
      if (hasCommittedEdit(observations)) {
        reportRunProgress(options, '剪辑工程已发布', 96)
        return completedEditResult(reply, observations)
      }
    }
    if (options.signal?.aborted) break

    messages.push({
      role: 'assistant',
      ...(response.content ? { content: response.content } : {}),
      toolCalls: selectedCalls,
    })
    for (const { call, observation } of roundObservations) {
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: serializeForModel(observation),
      })
    }
    messages[0] = {
      role: 'system',
      content: await buildTurnSystemPrompt(
        userText,
        options.history,
        await currentWorkspace(options),
        'native',
        availableToolIds,
      ),
    }
    messages.push({ role: 'user', content: nativeContinuePrompt.trim() })
  }

  return unfinishedResult(reply, observations, options.signal)
}

export async function runSingleAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
  config: { evidence?: unknown; maxToolRounds?: number; availableToolIds?: readonly string[] } = {},
): Promise<AiEditingRunResult> {
  const timelineRevisionBefore = getTimelineRevision()
  const codingSession = await startTimelineCodingSession()
  try {
    const adapter = options.adapter ?? getAiEditingAdapter()
    reportRunProgress(options, '正在读取剪辑源码仓库', 6)
    const evidence = config.evidence ?? (await codingSession.promptContext())
    reportRunProgress(options, '正在整理项目结构和上下文', 18)
    const availableToolIds = config.availableToolIds ? new Set(config.availableToolIds) : undefined
    const requiresTimelineCommit = isConfirmedPlanExecutionRequest(userText, options.history)
    let result: AiEditingRunResult
    if (supportsNativeToolCalling(adapter)) {
      reportRunProgress(options, '正在准备剪辑需求', 26)
      result = await runNativeToolLoop(
        toNativeMessages(
          await buildInitialMessages(
            userText,
            options.history,
            evidence,
            'native',
            availableToolIds,
          ),
        ),
        userText,
        options,
        adapter,
        config.maxToolRounds,
        availableToolIds,
        requiresTimelineCommit,
      )
    } else {
      reportRunProgress(options, '正在准备剪辑需求', 26)
      result = await runJsonToolLoop(
        await buildInitialMessages(userText, options.history, evidence, 'json', availableToolIds),
        userText,
        options,
        adapter,
        undefined,
        config.maxToolRounds,
        availableToolIds,
        [],
        requiresTimelineCommit,
      )
    }
    const failedEdit = latestFailedEdit(result.observations)
    const failureMessage = failedEdit ? failedEditMessage(failedEdit) : undefined
    return {
      ...result,
      reply: failureMessage
        ? `剪辑工程没有发布：${failureMessage}`
        : result.completed
          ? result.reply
          : defaultReply(result.observations),
      plan: declaredPlan(result.observations),
      completed: !failedEdit && result.completed,
      completionNotes: failureMessage ? [failureMessage] : result.completionNotes,
      timelineRevisionBefore,
      timelineRevisionAfter: getTimelineRevision(),
    }
  } finally {
    clearTimelineCodingSession(codingSession)
  }
}
