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
import { buildAiEditingSystemPrompt } from './agent-prompt'
import { getTimelineRevision } from './evidence'
import { buildAgentWorkspaceDocument } from './workspace-document/build-workspace-document'
import { parseAiEditingResponse } from './response-parser'
import { latestFailedEdit } from './latest-edit-result'
import { createNativeToolCatalog } from './native-tool-catalog'
import invalidJsonPrompt from './prompts/messages/invalid-json.md?raw'
import missingFinishPrompt from './prompts/messages/missing-finish.md?raw'
import nativeContinuePrompt from './prompts/messages/native-continue.md?raw'
import toolResultsPrompt from './prompts/messages/tool-results.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import type { AiEditingObservation } from './types'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'
import { executeNativeToolCall, executeToolCall, serializeForModel } from './tool-execution'
import { reportModelRequestStatus, reportRunProgress, traceRun as trace } from './orchestration-progress'
import {
  buildInitialMessages,
  buildJsonFallbackMessages,
  currentWorkspace,
  toNativeMessages,
} from './orchestration-messages'
import {
  declaredPlan,
  defaultReply,
  deferredCall,
  EDIT_PROGRAM_TOOL_ID,
  FINISH_TOOL_ID,
  hasCommittedEdit,
  terminalState,
  validateFinishObservation,
} from './orchestration-results'

const MAX_TOOL_ROUNDS = 8
const MAX_TOKENS = 4_096

export function getAiEditingAdapter(): LlmAdapter {
  if (getEmbeddedHostBridge().aiAssistant) return openAiChatCompletionsLlmAdapter
  return getDefaultLlmAdapter()
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
): Promise<AiEditingRunResult> {
  const observations: AiEditingObservation[] = [...initialObservations]
  let reply = ''
  let callIndex = 0
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
      round === 0 ? 32 : Math.min(88, 70 + round * 3),
      round === 0 ? 68 : Math.min(92, 82 + round * 2),
    )
    let raw: string
    try {
      raw = rawFromPreviousRequest ?? await adapter.generate(messages, {
        maxTokens: MAX_TOKENS,
        temperature: 0,
        reasoningEffort: options.reasoningEffort,
        signal: options.signal,
        onToken: options.onToken,
        onStatus: (status) => reportModelRequestStatus(options, status, round === 0 ? 32 : 70),
      })
    } catch (error) {
      trace(options, 'model-error', '模型请求失败。', {
        round: round + 1,
        error: error instanceof Error ? error.message : String(error),
      })
      if (!hasCommittedEdit(observations)) throw error
      const message = error instanceof Error ? error.message : '后续剪辑生成失败。'
      return {
        reply: `已保存前面完成的剪辑片段；后续处理失败：${message}`,
        observations,
        plan: [],
        completed: false,
        completionNotes: [message],
        timelineRevisionBefore: 0,
        timelineRevisionAfter: 0,
      }
    }
    trace(options, 'model-response', `模型返回第 ${round + 1} 轮结果。`, {
      protocol: 'json',
      round: round + 1,
      raw,
    })
    rawFromPreviousRequest = undefined
    reportRunProgress(options, '正在检查处理结果', round === 0 ? 72 : Math.min(94, 84 + round * 2))
    const parsed = parseAiEditingResponse(raw)
    if (!parsed) {
      trace(options, 'protocol-error', '模型返回内容无法解析为工具协议。', { round: round + 1 })
      if (round === maxRounds - 1) {
        throw new Error('助手这次没有按约定返回剪辑操作，已自动重试多次。请再试一次。')
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: invalidJsonPrompt.trim() })
      continue
    }

    reply = parsed.reply || reply
    if (parsed.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: missingFinishPrompt.trim() })
      continue
    }

    const roundObservations: AiEditingObservation[] = []
    let editCallSeen = false
    for (const call of parsed.toolCalls.slice(0, 3)) {
      if (options.signal?.aborted) break
      trace(options, 'tool-start', `开始执行工具 ${call.id}。`, {
        round: round + 1,
        toolId: call.id,
        arguments: call.args,
      })
      let observation: AiEditingObservation
      if (call.id === EDIT_PROGRAM_TOOL_ID && editCallSeen) {
        observation = deferredCall(
          call.id,
          '同一轮只能提交一份编辑程序。请读取最新版本后再提交下一段。',
        )
      } else if (call.id === FINISH_TOOL_ID && editCallSeen) {
        observation = deferredCall(
          call.id,
          '请先读取刚提交片段的实际结果，再判断是否完成。',
        )
      } else {
        observation = await executeToolCall(call, callIndex, options, availableToolIds)
      }
      if (call.id === EDIT_PROGRAM_TOOL_ID) editCallSeen = true
      observation = validateFinishObservation(observation, observations)
      callIndex += 1
      roundObservations.push(observation)
      observations.push(observation)
      trace(options, 'tool-result', `工具 ${observation.toolId} 执行结束。`, {
        round: round + 1,
        toolId: observation.toolId,
        result: observation.result,
      })
    }
    if (options.signal?.aborted) break

    const terminal = terminalState(observations)
    if (terminal.finished) {
      trace(options, 'terminal', '模型声明本轮任务结束。', terminal)
      reportRunProgress(options, '处理结果已确认', 96)
      break
    }

    messages.push({ role: 'assistant', content: raw })
    messages[0] = {
      role: 'system',
      content: await buildAiEditingSystemPrompt(
        await currentWorkspace(options),
        'json',
        userText,
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

  const terminal = terminalState(observations)
  const unfinishedReply = hasCommittedEdit(observations)
    ? '已保存本轮完成的剪辑片段；剩余部分尚未在本轮操作上限内完成。'
    : '本轮达到操作上限，尚未完成用户目标。'
  return {
    reply: terminal.finished
      ? terminal.outcome === 'responded'
        ? reply || terminal.reply || defaultReply(observations)
        : terminal.reply || reply || defaultReply(observations)
      : unfinishedReply,
    observations,
    plan: [],
    completed: terminal.completed && !options.signal?.aborted,
    completionNotes: terminal.finished
      ? terminal.completionNotes
      : ['本轮没有在操作上限内完成用户目标。'],
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
  availableToolIds?: ReadonlySet<string>,
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
      round === 0 ? 32 : Math.min(88, 70 + round * 3),
      round === 0 ? 68 : Math.min(92, 82 + round * 2),
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
      const message = error instanceof Error ? error.message : '后续剪辑生成失败。'
      return {
        reply: `已保存前面完成的剪辑片段；后续处理失败：${message}`,
        observations,
        plan: [],
        completed: false,
        completionNotes: [message],
        timelineRevisionBefore: 0,
        timelineRevisionAfter: 0,
      }
    }
    trace(options, 'model-response', `模型返回第 ${round + 1} 轮结果。`, {
      protocol: 'native',
      round: round + 1,
      mode: response.mode,
      content: 'content' in response ? response.content : undefined,
      toolCalls: 'toolCalls' in response ? response.toolCalls : undefined,
    })
    if (response.mode === 'fallback') {
      trace(options, 'protocol-fallback', '原生工具协议不可用，切换兼容协议。')
      return runJsonToolLoop(
        await buildJsonFallbackMessages(userText, options.history, observations, options, availableToolIds),
        userText,
        options,
        adapter,
        undefined,
        maxRounds,
        availableToolIds,
        observations,
      )
    }
    if (response.mode === 'json') {
      return runJsonToolLoop(
        await buildJsonFallbackMessages(userText, options.history, observations, options, availableToolIds),
        userText,
        options,
        adapter,
        response.content,
        maxRounds,
        availableToolIds,
        observations,
      )
    }

    reportRunProgress(options, '正在检查处理结果', round === 0 ? 72 : Math.min(94, 84 + round * 2))
    if (response.content) reply = response.content
    if (response.toolCalls.length === 0) {
      if (response.content) options.onToken?.(response.content, response.content)
      messages.push({ role: 'assistant', ...(response.content ? { content: response.content } : {}) })
      messages.push({ role: 'user', content: missingFinishPrompt.trim() })
      continue
    }

    const roundObservations: Array<{ call: EmbeddedAiAssistantToolCall; observation: AiEditingObservation }> = []
    let editCallSeen = false
    for (const call of response.toolCalls) {
      if (options.signal?.aborted) break
      const toolId = catalog.idsByFunctionName.get(call.name) ?? call.name
      trace(options, 'tool-start', `开始执行工具 ${toolId}。`, {
        round: round + 1,
        toolId,
        arguments: call.arguments,
      })
      let observation: AiEditingObservation
      if (toolId === EDIT_PROGRAM_TOOL_ID && editCallSeen) {
        observation = deferredCall(
          toolId,
          '同一轮只能提交一份编辑程序。请读取最新版本后再提交下一段。',
        )
      } else if (toolId === FINISH_TOOL_ID && editCallSeen) {
        observation = deferredCall(
          toolId,
          '请先读取刚提交片段的实际结果，再判断是否完成。',
        )
      } else {
        observation = await executeNativeToolCall(
          call,
          catalog.idsByFunctionName,
          callIndex,
          options,
          availableToolIds,
        )
      }
      if (toolId === EDIT_PROGRAM_TOOL_ID) editCallSeen = true
      observation = validateFinishObservation(observation, observations)
      callIndex += 1
      observations.push(observation)
      roundObservations.push({ call, observation })
      trace(options, 'tool-result', `工具 ${observation.toolId} 执行结束。`, {
        round: round + 1,
        toolId: observation.toolId,
        arguments: call.arguments,
        result: observation.result,
      })
    }
    if (options.signal?.aborted) break

    const terminal = terminalState(observations)
    if (terminal.finished) {
      trace(options, 'terminal', '模型声明本轮任务结束。', terminal)
      reportRunProgress(options, '处理结果已确认', 96)
      break
    }

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
    messages[0] = {
      role: 'system',
      content: await buildAiEditingSystemPrompt(
        await currentWorkspace(options),
        'native',
        userText,
        availableToolIds,
      ),
    }
    messages.push({
      role: 'user',
      content: nativeContinuePrompt.trim(),
    })
  }

  const terminal = terminalState(observations)
  const unfinishedReply = hasCommittedEdit(observations)
    ? '已保存本轮完成的剪辑片段；剩余部分尚未在本轮操作上限内完成。'
    : '本轮达到操作上限，尚未完成用户目标。'
  return {
    reply: terminal.finished
      ? terminal.outcome === 'responded'
        ? reply || terminal.reply || defaultReply(observations)
        : terminal.reply || reply || defaultReply(observations)
      : unfinishedReply,
    observations,
    plan: [],
    completed: terminal.completed && !options.signal?.aborted,
    completionNotes: terminal.finished
      ? terminal.completionNotes
      : ['本轮没有在操作上限内完成用户目标。'],
    timelineRevisionBefore: 0,
    timelineRevisionAfter: 0,
  }
}

export async function runSingleAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
  config: { evidence?: unknown; maxToolRounds?: number; availableToolIds?: readonly string[] } = {},
): Promise<AiEditingRunResult> {
  const adapter = options.adapter ?? getAiEditingAdapter()
  reportRunProgress(options, '正在读取当前编辑空间', 6)
  const evidence = config.evidence ?? await buildAgentWorkspaceDocument()
  reportRunProgress(options, '正在整理轨道、素材和上下文', 18)
  const timelineRevisionBefore = getTimelineRevision()
  const availableToolIds = config.availableToolIds
    ? new Set([...config.availableToolIds, FINISH_TOOL_ID])
    : undefined
  let result: AiEditingRunResult
  if (supportsNativeToolCalling(adapter)) {
    reportRunProgress(options, '正在准备剪辑需求', 26)
    result = await runNativeToolLoop(
      toNativeMessages(await buildInitialMessages(
        userText,
        options.history,
        evidence,
        'native',
        availableToolIds,
      )),
      userText,
      options,
      adapter,
      config.maxToolRounds,
      availableToolIds,
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
    )
  }
  const failedEdit = latestFailedEdit(result.observations)
  const committedBeforeFailure = Boolean(failedEdit && hasCommittedEdit(result.observations))
  return {
    ...result,
    ...(failedEdit
      ? {
          reply: committedBeforeFailure
            ? `已保存前面完成的剪辑片段；后续片段没有提交：${failedEdit.result.message}`
            : `编辑程序没有提交：${failedEdit.result.message}`,
        }
      : {}),
    plan: declaredPlan(result.observations),
    completed: !failedEdit && result.completed,
    completionNotes: failedEdit
      ? [failedEdit.result.message]
      : result.completionNotes,
    timelineRevisionBefore,
    timelineRevisionAfter: getTimelineRevision(),
  }
}
