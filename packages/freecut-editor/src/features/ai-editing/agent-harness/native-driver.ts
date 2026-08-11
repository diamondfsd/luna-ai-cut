import type { LlmGenerateOptions } from '@freecut/infrastructure/llm'
import type { NativeToolCallingLlmAdapter } from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import type {
  EmbeddedAiAssistantMessage,
  EmbeddedAiAssistantToolCall,
  EmbeddedAiAssistantToolDefinition,
} from '@freecut/shared/host/embedded-host'
import type {
  AgentHarnessDriver,
  AgentHarnessModelOutput,
  AgentHarnessModelRequest,
  AgentHarnessModelStep,
  AgentHarnessToolExchange,
} from './types'

interface NativeAgentDriverOptions<TObservation> {
  adapter: NativeToolCallingLlmAdapter
  messages: EmbeddedAiAssistantMessage[]
  replayFromIndex?: number
  getTools(): {
    definitions: EmbeddedAiAssistantToolDefinition[]
    idsByFunctionName: ReadonlyMap<string, string>
  }
  serializeObservation(observation: TObservation): string
  toolContinuationPrompt?: string
  requestOptions(round: number): LlmGenerateOptions
  onRequest?(request: AgentHarnessModelRequest): void
}

function generationParameters(options: LlmGenerateOptions): AgentHarnessModelRequest['generation'] {
  return {
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.topP === undefined ? {} : { topP: options.topP }),
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
  }
}

function parseArguments(value: string): unknown {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : value
  } catch {
    return value
  }
}

export class NativeAgentDriver<TObservation> implements AgentHarnessDriver<TObservation> {
  readonly protocol = 'native'
  private readonly messages: EmbeddedAiAssistantMessage[]
  private readonly callsById = new Map<string, EmbeddedAiAssistantToolCall>()
  private readonly replayFromIndex: number

  constructor(private readonly options: NativeAgentDriverOptions<TObservation>) {
    this.messages = structuredClone(options.messages)
    this.replayFromIndex = options.replayFromIndex ?? this.messages.length
  }

  get messageCount(): number {
    return this.messages.length
  }

  get replayMessages(): EmbeddedAiAssistantMessage[] {
    return structuredClone(this.messages.slice(this.replayFromIndex))
  }

  async request(input: { round: number }): Promise<AgentHarnessModelStep> {
    const requestOptions = this.options.requestOptions(input.round)
    const tools = this.options.getTools()
    this.options.onRequest?.({
      protocol: 'native',
      round: input.round + 1,
      messages: structuredClone(this.messages),
      tools: structuredClone(tools.definitions),
      generation: generationParameters(requestOptions),
    })
    const response = await this.options.adapter.generateWithTools(
      this.messages,
      tools.definitions,
      requestOptions,
    )
    if (response.mode === 'fallback' || response.mode === 'json') {
      return {
        kind: 'fallback',
        ...(response.mode === 'json' ? { content: response.content } : {}),
      }
    }

    for (const call of response.toolCalls) this.callsById.set(call.id, call)
    return {
      kind: 'output',
      output: {
        content: response.content,
        raw: response.content,
        toolCalls: response.toolCalls.map((call) => ({
          callId: call.id,
          toolId: tools.idsByFunctionName.get(call.name) ?? call.name,
          input: parseArguments(call.arguments),
        })),
      },
    }
  }

  recordProtocolError(): void {
    // Native function calling has no text protocol to repair.
  }

  recordContinuation(output: AgentHarnessModelOutput, continuationPrompt: string): void {
    this.messages.push({
      role: 'assistant',
      ...(output.content ? { content: output.content } : {}),
    })
    this.messages.push({ role: 'user', content: continuationPrompt })
  }

  recordFinalOutput(output: AgentHarnessModelOutput): void {
    if (!output.content) return
    this.messages.push({
      role: 'assistant',
      content: output.content,
    })
  }

  recordUserPrompt(prompt: string): void {
    this.messages.push({ role: 'user', content: prompt })
  }

  recordToolResults(
    output: AgentHarnessModelOutput,
    exchanges: readonly AgentHarnessToolExchange<TObservation>[],
    continueAfterTools = true,
  ): void {
    const toolCalls = exchanges
      .map(({ call }) => this.callsById.get(call.callId))
      .filter((call): call is EmbeddedAiAssistantToolCall => call !== undefined)
    this.messages.push({
      role: 'assistant',
      ...(output.content ? { content: output.content } : {}),
      toolCalls,
    })
    for (const { call, observation } of exchanges) {
      this.messages.push({
        role: 'tool',
        toolCallId: call.callId,
        content: this.options.serializeObservation(observation),
      })
    }
    if (continueAfterTools && this.options.toolContinuationPrompt) {
      this.messages.push({ role: 'user', content: this.options.toolContinuationPrompt })
    }
  }
}
