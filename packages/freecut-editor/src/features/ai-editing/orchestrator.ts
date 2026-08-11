import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import { getDefaultLlmAdapter } from '@freecut/infrastructure/llm'
import {
  openAiChatCompletionsLlmAdapter,
  supportsNativeToolCalling,
  type NativeToolCallingLlmAdapter,
} from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import {
  JsonAgentDriver,
  NativeAgentDriver,
  runAgentHarness,
  type AgentHarnessDriver,
  type AgentHarnessEvent,
  type AgentHarnessResult,
  type AgentHarnessToolCall,
} from './agent-harness'
import {
  clearTimelineCodingSession,
  startTimelineCodingSession,
} from './coding-workspace/session-registry'
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
import { reportModelRequestStatus, reportRunProgress, traceRun } from './orchestration-progress'
import {
  declaredPlan,
  defaultReply,
  hasCommittedEdit,
  hasSourceChanges,
  hasUncommittedSourceWork,
} from './orchestration-results'
import invalidJsonPrompt from './prompts/messages/invalid-json.md?raw'
import pendingWorkPrompt from './prompts/messages/missing-finish.md?raw'
import nativeContinuePrompt from './prompts/messages/native-continue.md?raw'
import toolResultsPrompt from './prompts/messages/tool-results.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { parseAiEditingResponse } from './response-parser'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'
import { executeToolCall, serializeForModel } from './tool-execution'
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
    changedProject: hasSourceChanges(input.observations),
    completionNotes: input.completionNotes ?? [],
  }
}

function unfinishedResult(
  reply: string,
  observations: AiEditingObservation[],
  signal?: AbortSignal,
): AiEditingRunResult {
  const note = signal?.aborted
    ? '用户停止了本次处理。'
    : hasUncommittedSourceWork(observations)
      ? '剪辑源码尚未提交。'
      : '本轮没有在操作上限内完成用户目标。'
  return loopResult({
    reply: reply || (signal?.aborted ? '已停止本次处理。' : defaultReply(observations)),
    observations,
    completed: false,
    completionNotes: [note],
  })
}

function completedResult(
  reply: string,
  observations: AiEditingObservation[],
): AiEditingRunResult {
  return loopResult({
    reply: hasCommittedEdit(observations) ? defaultReply(observations) : reply,
    observations,
    completed: true,
  })
}

function handleHarnessEvent(
  options: AiEditingRunOptions,
  event: AgentHarnessEvent<AiEditingObservation>,
): void {
  const round = event.round + 1
  if (event.type === 'model-request') {
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
    traceRun(options, 'model-error', '模型请求失败。', {
      round,
      error: event.error instanceof Error ? event.error.message : String(event.error),
    })
    return
  }
  if (event.type === 'protocol-error') {
    traceRun(options, 'protocol-error', '模型返回内容无法解析为工具协议。', { round })
    return
  }
  if (event.type === 'tool-start') {
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
  options: AiEditingRunOptions,
  availableToolIds?: ReadonlySet<string>,
): Promise<AiEditingObservation> {
  return executeToolCall(
    { id: call.toolId, args: call.input as Record<string, unknown> },
    callIndex,
    options,
    availableToolIds,
  )
}

async function runDriver(
  driver: AgentHarnessDriver<AiEditingObservation>,
  userText: string,
  options: AiEditingRunOptions,
  config: {
    maxRounds: number
    availableToolIds?: ReadonlySet<string>
    initialObservations?: readonly AiEditingObservation[]
    requiresEditCommit: boolean
    continuationPrompt: string
  },
): Promise<AgentHarnessResult<AiEditingObservation>> {
  return runAgentHarness({
    driver,
    maxRounds: config.maxRounds,
    maxToolCallsPerRound: MAX_TOOL_CALLS_PER_ROUND,
    initialObservations: config.initialObservations,
    signal: options.signal,
    protocolRepairPrompt: invalidJsonPrompt.trim(),
    continuationPrompt: config.continuationPrompt,
    instructions: async () => buildTurnSystemPrompt(
      userText,
      options.history,
      await currentWorkspace(options),
      driver.protocol === 'native' ? 'native' : 'json',
      config.availableToolIds,
      config.requiresEditCommit,
    ),
    executeTool: (call, index) => executeHarnessTool(
      call,
      index,
      options,
      config.availableToolIds,
    ),
    canCompleteFromText: ({ output, observations }) =>
      !config.requiresEditCommit &&
      Boolean(output.content.trim()) &&
      !isDeferredTextReply(output.content) &&
      !hasUncommittedSourceWork(observations),
    shouldStopAfterTool: hasCommittedEdit,
    canRecoverFromModelError: hasCommittedEdit,
    onTextCompletion: (content) => options.onFinalText?.(content),
    onEvent: (event) => handleHarnessEvent(options, event),
  })
}

function toRunResult(
  result: AgentHarnessResult<AiEditingObservation>,
  signal?: AbortSignal,
): AiEditingRunResult {
  return result.status === 'completed'
    ? completedResult(result.reply, result.observations)
    : unfinishedResult(result.reply, result.observations, signal)
}

async function createJsonDriver(
  adapter: LlmAdapter,
  messages: LlmMessage[],
  options: AiEditingRunOptions,
  initialRaw?: string,
): Promise<JsonAgentDriver<AiEditingObservation>> {
  return new JsonAgentDriver({
    adapter,
    messages,
    parse: parseAiEditingResponse,
    renderToolResults: (observations) => renderPrompt(toolResultsPrompt, {
      OBSERVATIONS: serializeForModel(observations),
    }),
    requestOptions: (round) => ({
      maxTokens: MAX_TOKENS,
      temperature: 0,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
      onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
    }),
    onRequest: (request) => {
      traceRun(options, 'model-context', `已保存第 ${request.round} 次模型调用的完整上下文。`, request)
    },
    initialRaw,
  })
}

function createNativeDriver(
  adapter: NativeToolCallingLlmAdapter,
  messages: LlmMessage[],
  options: AiEditingRunOptions,
  availableToolIds?: ReadonlySet<string>,
): NativeAgentDriver<AiEditingObservation> {
  const catalog = createNativeToolCatalog(availableToolIds)
  return new NativeAgentDriver({
    adapter,
    messages: toNativeMessages(messages),
    tools: catalog.definitions,
    toolIdsByFunctionName: catalog.idsByFunctionName,
    serializeObservation: serializeForModel,
    toolContinuationPrompt: nativeContinuePrompt.trim(),
    requestOptions: (round) => ({
      maxTokens: MAX_TOKENS,
      temperature: 0,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
      onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
    }),
    onRequest: (request) => {
      traceRun(options, 'model-context', `已保存第 ${request.round} 次模型调用的完整上下文。`, request)
    },
  })
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
    const availableToolIds = config.availableToolIds ? new Set(config.availableToolIds) : undefined
    const requiresEditCommit = options.turnIntent?.kind === 'execute-approved-plan' ||
      isConfirmedPlanExecutionRequest(userText, options.history)
    reportRunProgress(options, '正在读取剪辑源码仓库', 6)
    const evidence = config.evidence ?? (await codingSession.promptContext())
    reportRunProgress(options, '正在整理项目结构和上下文', 18)
    reportRunProgress(options, '正在准备剪辑需求', 26)

    let harnessResult: AgentHarnessResult<AiEditingObservation>
    if (supportsNativeToolCalling(adapter)) {
      const nativeMessages = await buildInitialMessages(
        userText,
        options.history,
        evidence,
        'native',
        availableToolIds,
        requiresEditCommit,
      )
      harnessResult = await runDriver(
        createNativeDriver(adapter, nativeMessages, options, availableToolIds),
        userText,
        options,
        {
          maxRounds,
          availableToolIds,
          requiresEditCommit,
          continuationPrompt: pendingWorkPrompt.trim(),
        },
      )
      if (harnessResult.status === 'fallback') {
        const fallbackMessages = await buildJsonFallbackMessages(
          userText,
          options.history,
          harnessResult.observations,
          options,
          availableToolIds,
        )
        harnessResult = await runDriver(
          await createJsonDriver(adapter, fallbackMessages, options, harnessResult.fallbackContent),
          userText,
          options,
          {
            maxRounds,
            availableToolIds,
            initialObservations: harnessResult.observations,
            requiresEditCommit,
            continuationPrompt: pendingWorkPrompt.trim(),
          },
        )
      }
    } else {
      const jsonMessages = await buildInitialMessages(
        userText,
        options.history,
        evidence,
        'json',
        availableToolIds,
        requiresEditCommit,
      )
      harnessResult = await runDriver(
        await createJsonDriver(adapter, jsonMessages, options),
        userText,
        options,
        {
          maxRounds,
          availableToolIds,
          requiresEditCommit,
          continuationPrompt: pendingWorkPrompt.trim(),
        },
      )
    }

    const result = toRunResult(harnessResult, options.signal)
    const failedEdit = latestFailedEdit(result.observations)
    const failureMessage = failedEdit ? failedEditMessage(failedEdit) : undefined
    return {
      ...result,
      reply: failureMessage
        ? `剪辑工程没有完成：${failureMessage}`
        : result.completed
          ? result.reply
          : defaultReply(result.observations),
      plan: declaredPlan(result.observations),
      completed: !failedEdit && result.completed,
      completionNotes: failureMessage ? [failureMessage] : result.completionNotes,
    }
  } finally {
    clearTimelineCodingSession(codingSession)
  }
}
