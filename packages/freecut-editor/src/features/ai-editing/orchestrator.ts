import type { LlmAdapter } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import {
  openAiChatCompletionsLlmAdapter,
  supportsNativeToolCalling,
} from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import {
  runAgentHarness,
  type AgentHarnessDriver,
  type AgentHarnessEvent,
  type AgentHarnessResult,
  type AgentHarnessToolCall,
  type AiEditingAgentTurn,
} from './agent-harness'
import {
  clearTimelineCodingSession,
  startTimelineCodingSession,
} from './coding-workspace/session-registry'
import { failedEditMessage, latestFailedEdit } from './latest-edit-result'
import {
  editFailureKey,
  MAX_REPEATED_EDIT_FAILURES,
  repeatedEditFailureCount,
} from './edit-failure-guard'
import { AiEditingToolSet } from './tool-set'
import { createJsonDriver, createNativeDriver } from './orchestration-drivers'
import {
  buildInitialMessages,
  buildInitialNativeMessages,
  buildJsonFallbackMessages,
  isConfirmedPlanExecutionRequest,
  replayMessagesForJson,
} from './orchestration-messages'
import { reportRunProgress, traceRun } from './orchestration-progress'
import {
  declaredPlan,
  defaultReply,
  hasCommittedEdit,
  hasSourceChanges,
  hasUncommittedSourceWork,
  incompleteReply,
} from './orchestration-results'
import invalidJsonPrompt from './prompts/messages/invalid-json.md?raw'
import finalizationPrompt from './prompts/messages/finalize.md?raw'
import pendingWorkPrompt from './prompts/messages/missing-finish.md?raw'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'
import { executeToolCall } from './tool-execution'
import { getAiEditingTool } from './tool-registry'
import type { AiEditingObservation } from './types'

const MAX_TOOL_ROUNDS = 20
const MAX_TOOL_CALLS_PER_ROUND = 8
const MAX_CONSECUTIVE_DUPLICATE_READS = 2
const MAX_TRANSCRIPT_SEARCH_CALLS = 6

function isDeferredTextReply(reply: string): boolean {
  const text = reply.trim()
  if (text.length >= 120) return false
  return /(我来帮你|我会帮你|接下来.{0,12}(给你|提供)|直接给你.{0,12}(方案|脚本)|马上.{0,12}(开始|给你))/.test(text)
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizedJson(entry)]),
  )
}

function readToolCallKey(call: AgentHarnessToolCall): string | null {
  if (getAiEditingTool(call.toolId)?.risk !== 'read') return null
  return `${call.toolId}:${JSON.stringify(normalizedJson(call.input))}`
}

function repeatedReadCount(observation: AiEditingObservation | undefined): number {
  const data = observation?.result.data
  if (!data || typeof data !== 'object') return 0
  const count = (data as { consecutiveDuplicateReadCount?: unknown }).consecutiveDuplicateReadCount
  return typeof count === 'number' ? count : 0
}

function exhaustedToolBudgetRounds(observation: AiEditingObservation | undefined): number {
  const data = observation?.result.data
  if (!data || typeof data !== 'object') return 0
  const count = (data as { exhaustedToolBudgetRounds?: unknown }).exhaustedToolBudgetRounds
  return typeof count === 'number' ? count : 0
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
  agentTurn: AiEditingAgentTurn
  loadedToolIds: string[]
}): AiEditingRunResult {
  return {
    reply: input.reply,
    observations: input.observations,
    plan: [],
    completed: input.completed,
    changedProject: hasSourceChanges(input.observations),
    completionNotes: input.completionNotes ?? [],
    agentTurn: input.agentTurn,
    loadedToolIds: input.loadedToolIds,
  }
}

function unfinishedResult(
  reply: string,
  observations: AiEditingObservation[],
  agentTurn: AiEditingAgentTurn,
  loadedToolIds: string[],
  signal?: AbortSignal,
): AiEditingRunResult {
  const note = signal?.aborted
    ? '用户停止了本次处理。'
    : hasUncommittedSourceWork(observations)
      ? '剪辑源码尚未提交。'
      : '本轮没有在操作上限内完成用户目标。'
  const partialReply = reply.trim()
  const canKeepPartialReply = partialReply.length >= 20 &&
    !isDeferredTextReply(partialReply) &&
    partialReply !== defaultReply(observations)
  return loopResult({
    reply: signal?.aborted
      ? '已停止本次处理。'
      : canKeepPartialReply
        ? `${partialReply}\n\n> 本次处理未完成：${note}`
        : incompleteReply(observations, note),
    observations,
    completed: false,
    completionNotes: [note],
    agentTurn,
    loadedToolIds,
  })
}

function completedResult(
  reply: string,
  observations: AiEditingObservation[],
  agentTurn: AiEditingAgentTurn,
  loadedToolIds: string[],
): AiEditingRunResult {
  return loopResult({
    reply: hasCommittedEdit(observations) ? defaultReply(observations) : reply,
    observations,
    completed: true,
    agentTurn,
    loadedToolIds,
  })
}

function handleHarnessEvent(
  options: AiEditingRunOptions,
  event: AgentHarnessEvent<AiEditingObservation>,
): void {
  const round = event.round + 1
  if (event.type === 'model-request') {
    options.onFinalText?.('')
    traceRun(options, 'model-request', `请求模型处理第 ${round} 轮。`, {
      protocol: event.protocol,
      round,
      messageCount: event.messageCount,
    })
    reportRunProgress(
      options,
      event.round === 0 ? '正在理解需求' : '正在根据执行结果继续处理',
      event.round === 0 ? 32 : Math.min(90, 68 + event.round * 2),
      event.round === 0 ? 68 : Math.min(94, 80 + event.round * 2),
    )
    return
  }
  if (event.type === 'model-response') {
    traceRun(options, 'model-response', `模型返回第 ${round} 轮结果。`, {
      protocol: event.protocol,
      round,
      step: event.step,
    })
    reportRunProgress(options, '正在检查处理结果', Math.min(95, 72 + event.round * 2))
    return
  }
  if (event.type === 'model-error') {
    options.onFinalText?.('')
    traceRun(options, 'model-error', '模型请求失败。', {
      round,
      error: event.error instanceof Error ? event.error.message : String(event.error),
    })
    return
  }
  if (event.type === 'protocol-error') {
    options.onFinalText?.('')
    traceRun(options, 'protocol-error', '模型返回内容无法解析为工具协议。', { round })
    return
  }
  if (event.type === 'tool-start') {
    options.onFinalText?.('')
    traceRun(options, 'tool-start', `开始执行工具 ${event.call.toolId}。`, {
      round,
      toolId: event.call.toolId,
      arguments: event.call.input,
    })
    return
  }
  traceRun(options, 'tool-result', `工具 ${event.exchange.call.toolId} 执行结束。`, {
    round,
    toolId: event.exchange.call.toolId,
    result: event.exchange.observation.result,
  })
  if (hasCommittedEdit([event.exchange.observation])) {
    reportRunProgress(options, '剪辑工程已保存', 96)
  }
}

async function executeHarnessTool(
  call: AgentHarnessToolCall,
  callIndex: number,
  round: number,
  options: AiEditingRunOptions,
  toolSet: AiEditingToolSet,
  duplicateGuard?: {
    key: string | null
    consecutiveCount: number
    transcriptSearchCount: number
    lastBudgetExhaustedRound: number
    budgetExhaustedRounds: number
    editFailureCounts: Map<string, number>
  },
): Promise<AiEditingObservation> {
  if (duplicateGuard && call.toolId === 'analysis.search_transcript') {
    duplicateGuard.transcriptSearchCount += 1
    if (duplicateGuard.transcriptSearchCount > MAX_TRANSCRIPT_SEARCH_CALLS) {
      if (duplicateGuard.lastBudgetExhaustedRound !== round) {
        duplicateGuard.lastBudgetExhaustedRound = round
        duplicateGuard.budgetExhaustedRounds += 1
      }
      const message = '本次请求的字幕关键词查询次数已达上限。请读取完整口播或使用已有证据，并立即完成最终答复，不要继续猜测关键词。'
      options.onToolActivity?.({
        id: `${options.activityScope ?? 'turn'}-${callIndex}-${call.toolId}`,
        toolId: call.toolId,
        title: getAiEditingTool(call.toolId)?.title ?? call.toolId,
        status: 'failed',
        message,
      })
      return {
        toolId: call.toolId,
        result: {
          ok: false,
          message,
          data: { exhaustedToolBudgetRounds: duplicateGuard.budgetExhaustedRounds },
        },
      }
    }
  }

  const key = readToolCallKey(call)
  if (duplicateGuard && key && key === duplicateGuard.key) {
    duplicateGuard.consecutiveCount += 1
    const tool = getAiEditingTool(call.toolId)
    const message = '这个查询与上一次完全相同，项目状态没有变化。请直接使用已有结果继续处理。'
    options.onToolActivity?.({
      id: `${options.activityScope ?? 'turn'}-${callIndex}-${call.toolId}`,
      toolId: call.toolId,
      title: tool?.title ?? call.toolId,
      status: 'failed',
      message,
    })
    return {
      toolId: call.toolId,
      result: {
        ok: false,
        message,
        data: { consecutiveDuplicateReadCount: duplicateGuard.consecutiveCount },
      },
    }
  }

  if (duplicateGuard) {
    duplicateGuard.key = key
    duplicateGuard.consecutiveCount = 0
  }
  const observation = await executeToolCall(
    { id: call.toolId, args: call.input as Record<string, unknown> },
    callIndex,
    options,
    toolSet.availableToolIds,
  )
  const failureKey = editFailureKey(call, observation)
  if (duplicateGuard && failureKey) {
    const count = (duplicateGuard.editFailureCounts.get(failureKey) ?? 0) + 1
    duplicateGuard.editFailureCounts.set(failureKey, count)
    if (count >= MAX_REPEATED_EDIT_FAILURES) {
      const data = observation.result.data && typeof observation.result.data === 'object'
        ? observation.result.data as Record<string, unknown>
        : {}
      observation.result.data = { ...data, repeatedEditFailureCount: count }
    }
  }
  return observation
}

async function runDriver(
  driver: AgentHarnessDriver<AiEditingObservation>,
  options: AiEditingRunOptions,
  config: {
    maxRounds: number
    toolSet: AiEditingToolSet
    initialObservations?: readonly AiEditingObservation[]
    requiresEditCommit: boolean
    continuationPrompt: string
  },
): Promise<AgentHarnessResult<AiEditingObservation>> {
  const duplicateGuard = {
    key: null as string | null,
    consecutiveCount: 0,
    transcriptSearchCount: 0,
    lastBudgetExhaustedRound: -1,
    budgetExhaustedRounds: 0,
    editFailureCounts: new Map<string, number>(),
  }
  return runAgentHarness({
    driver,
    maxRounds: config.maxRounds,
    maxToolCallsPerRound: MAX_TOOL_CALLS_PER_ROUND,
    initialObservations: config.initialObservations,
    signal: options.signal,
    protocolRepairPrompt: invalidJsonPrompt.trim(),
    continuationPrompt: config.continuationPrompt,
    finalizationPrompt: finalizationPrompt.trim(),
    executeTool: (call, index, round) => executeHarnessTool(
      call,
      index,
      round,
      options,
      config.toolSet,
      duplicateGuard,
    ),
    canCompleteFromText: ({ output, observations }) =>
      !config.requiresEditCommit &&
      Boolean(output.content.trim()) &&
      !isDeferredTextReply(output.content) &&
      !hasUncommittedSourceWork(observations),
    shouldStopAfterTool: hasCommittedEdit,
    shouldFinalizeAfterTool: (observations) =>
      repeatedReadCount(observations.at(-1)) >= MAX_CONSECUTIVE_DUPLICATE_READS ||
      repeatedEditFailureCount(observations.at(-1)) >= MAX_REPEATED_EDIT_FAILURES ||
      exhaustedToolBudgetRounds(observations.at(-1)) >= 2,
    canRecoverFromModelError: hasCommittedEdit,
    onTextCompletion: (content) => options.onFinalText?.(content),
    onEvent: (event) => handleHarnessEvent(options, event),
  })
}

function toRunResult(
  result: AgentHarnessResult<AiEditingObservation>,
  loadedToolIds: string[],
  signal?: AbortSignal,
): AiEditingRunResult {
  const agentTurn: AiEditingAgentTurn = {
    id: crypto.randomUUID(),
    protocol: result.protocol,
    messages: result.replayMessages,
  }
  return result.status === 'completed'
    ? completedResult(result.reply, result.observations, agentTurn, loadedToolIds)
    : unfinishedResult(result.reply, result.observations, agentTurn, loadedToolIds, signal)
}

export async function runSingleAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
  config: { evidence?: unknown; maxToolRounds?: number; availableToolIds?: readonly string[] } = {},
): Promise<AiEditingRunResult> {
  const codingSession = await startTimelineCodingSession()
  try {
    const adapter = options.adapter ?? getAiEditingAdapter()
    const maxRounds = config.maxToolRounds ?? MAX_TOOL_ROUNDS
    const allowedToolIds = config.availableToolIds ? new Set(config.availableToolIds) : undefined
    const toolSet = new AiEditingToolSet(allowedToolIds)
    const requiresEditCommit = options.turnIntent?.kind === 'execute-approved-plan' ||
      options.turnIntent?.kind === 'execute-edit' ||
      isConfirmedPlanExecutionRequest(userText, options.history)
    reportRunProgress(options, '正在读取剪辑源码仓库', 6)
    const evidence = config.evidence ?? (await codingSession.promptContext())
    reportRunProgress(options, '正在整理项目结构和上下文', 18)
    reportRunProgress(options, '正在准备剪辑需求', 26)

    let harnessResult: AgentHarnessResult<AiEditingObservation>
    if (options.preferredProtocol !== 'json' && supportsNativeToolCalling(adapter)) {
      const nativeMessages = await buildInitialNativeMessages(
        userText,
        options.agentHistory ?? [],
        evidence,
        toolSet.availableToolIds,
        requiresEditCommit,
      )
      harnessResult = await runDriver(
        createNativeDriver(adapter, nativeMessages, options, toolSet),
        options,
        {
          maxRounds,
          toolSet,
          requiresEditCommit,
          continuationPrompt: pendingWorkPrompt.trim(),
        },
      )
      if (harnessResult.status === 'fallback') {
        const jsonInitialMessages = await buildInitialMessages(
          userText,
          options.agentHistory
            ? replayMessagesForJson(options.agentHistory)
            : options.history,
          evidence,
          'json',
          toolSet.availableToolIds,
          requiresEditCommit,
        )
        const fallbackMessages = buildJsonFallbackMessages(
          jsonInitialMessages,
          harnessResult.observations,
        )
        harnessResult = await runDriver(
          createJsonDriver(
            adapter,
            fallbackMessages,
            options,
            harnessResult.fallbackContent,
            Math.max(0, jsonInitialMessages.length - 2),
          ),
          options,
          {
            maxRounds,
            toolSet,
            initialObservations: harnessResult.observations,
            requiresEditCommit,
            continuationPrompt: pendingWorkPrompt.trim(),
          },
        )
      }
    } else {
      const jsonMessages = await buildInitialMessages(
        userText,
        options.agentHistory
          ? replayMessagesForJson(options.agentHistory)
          : options.history,
        evidence,
        'json',
        toolSet.availableToolIds,
        requiresEditCommit,
      )
      harnessResult = await runDriver(
        createJsonDriver(adapter, jsonMessages, options),
        options,
        {
          maxRounds,
          toolSet,
          requiresEditCommit,
          continuationPrompt: pendingWorkPrompt.trim(),
        },
      )
    }

    const result = toRunResult(harnessResult, [...toolSet.availableToolIds], options.signal)
    const failedEdit = latestFailedEdit(result.observations)
    const failureMessage = failedEdit ? failedEditMessage(failedEdit) : undefined
    return {
      ...result,
      reply: failureMessage
        ? `剪辑工程没有完成：${failureMessage}`
        : result.reply,
      plan: declaredPlan(result.observations),
      completed: !failedEdit && result.completed,
      completionNotes: failureMessage ? [failureMessage] : result.completionNotes,
    }
  } finally {
    await codingSession.finalizeRenderer()
    clearTimelineCodingSession(codingSession)
  }
}
