import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { NativeToolCallingLlmAdapter } from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import type { EmbeddedAiAssistantMessage } from '@freecut/shared/host/embedded-host'
import { JsonAgentDriver, NativeAgentDriver } from './agent-harness'
import type { AiEditingToolSet } from './tool-set'
import { createNativeToolCatalog } from './native-tool-catalog'
import { reportModelRequestStatus, traceRun } from './orchestration-progress'
import toolResultsPrompt from './prompts/messages/tool-results.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { parseAiEditingResponse } from './response-parser'
import type { AiEditingRunOptions } from './run-types'
import { serializeForModel, serializeToolResultsForModel } from './tool-execution'
import type { ToolResultStore } from './tool-result-store'
import type { AiEditingObservation } from './types'

const MAX_TOKENS = 8_192

function reportUsage(
  options: AiEditingRunOptions,
  protocol: 'json' | 'native',
  round: number,
  usage: Parameters<NonNullable<AiEditingRunOptions['onModelUsage']>>[0],
): void {
  const cachePercent = usage.promptTokens > 0
    ? usage.cachedTokens / usage.promptTokens * 100
    : 0
  traceRun(options, 'model-usage', `已记录第 ${round} 次模型调用的用量。`, {
    protocol,
    round,
    ...usage,
    cachePercent,
  })
  options.onModelUsage?.(usage)
}

export function createJsonDriver(
  adapter: LlmAdapter,
  messages: LlmMessage[],
  options: AiEditingRunOptions,
  resultStore: ToolResultStore,
  initialRaw?: string,
  replayFromIndex = Math.max(0, messages.length - 1),
): JsonAgentDriver<AiEditingObservation> {
  return new JsonAgentDriver({
    adapter,
    messages,
    replayFromIndex,
    parse: parseAiEditingResponse,
    renderToolResults: (observations) => renderPrompt(toolResultsPrompt, {
      OBSERVATIONS: serializeToolResultsForModel(observations, resultStore),
    }),
    requestOptions: (round) => ({
      maxTokens: MAX_TOKENS,
      temperature: 0,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
      onStatus: (status) => reportModelRequestStatus(
        options,
        status,
        round === 0 ? 32 : 70,
        true,
      ),
      onUsage: (usage) => reportUsage(options, 'json', round + 1, usage),
    }),
    onRequest: (request) => {
      traceRun(options, 'model-context', `已保存第 ${request.round} 次模型调用的完整上下文。`, request)
    },
    initialRaw,
  })
}

export function createNativeDriver(
  adapter: NativeToolCallingLlmAdapter,
  messages: EmbeddedAiAssistantMessage[],
  options: AiEditingRunOptions,
  toolSet: AiEditingToolSet,
  resultStore: ToolResultStore,
  replayFromIndex = Math.max(0, messages.length - 1),
): NativeAgentDriver<AiEditingObservation> {
  const tools = createNativeToolCatalog(toolSet.availableToolIds)
  return new NativeAgentDriver({
    adapter,
    messages,
    replayFromIndex,
    getTools: () => tools,
    serializeObservation: (observation) => serializeForModel(resultStore.forModel(observation)),
    requestOptions: (round) => ({
      maxTokens: MAX_TOKENS,
      temperature: 0,
      reasoningEffort: options.reasoningEffort,
      signal: options.signal,
      onStatus: (status) => reportModelRequestStatus(
        options,
        status,
        round === 0 ? 32 : 70,
        true,
      ),
      onUsage: (usage) => reportUsage(options, 'native', round + 1, usage),
    }),
    onRequest: (request) => {
      traceRun(options, 'model-context', `已保存第 ${request.round} 次模型调用的完整上下文。`, request)
    },
  })
}
