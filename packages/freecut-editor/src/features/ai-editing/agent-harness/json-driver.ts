import type { LlmAdapter, LlmGenerateOptions, LlmMessage } from '@freecut/infrastructure/llm'
import type { AiEditingResponse } from '../types'
import type {
  AgentHarnessDriver,
  AgentHarnessModelOutput,
  AgentHarnessModelRequest,
  AgentHarnessModelStep,
  AgentHarnessToolExchange,
} from './types'

interface JsonAgentDriverOptions<TObservation> {
  adapter: LlmAdapter
  messages: LlmMessage[]
  parse(raw: string): AiEditingResponse | null
  renderToolResults(observations: readonly TObservation[]): string
  requestOptions(round: number): LlmGenerateOptions
  onRequest?(request: AgentHarnessModelRequest): void
  initialRaw?: string
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

export class JsonAgentDriver<TObservation> implements AgentHarnessDriver<TObservation> {
  readonly protocol = 'json'
  private readonly messages: LlmMessage[]
  private initialRaw: string | undefined

  constructor(private readonly options: JsonAgentDriverOptions<TObservation>) {
    this.messages = structuredClone(options.messages)
    this.initialRaw = options.initialRaw
  }

  get messageCount(): number {
    return this.messages.length
  }

  async request(input: { round: number }): Promise<AgentHarnessModelStep> {
    let raw = this.initialRaw
    if (raw === undefined) {
      const requestOptions = this.options.requestOptions(input.round)
      this.options.onRequest?.({
        protocol: 'json',
        round: input.round + 1,
        messages: structuredClone(this.messages),
        generation: generationParameters(requestOptions),
      })
      raw = await this.options.adapter.generate(this.messages, requestOptions)
    }
    this.initialRaw = undefined
    const parsed = this.options.parse(raw)
    if (!parsed) return { kind: 'protocol-error', raw }
    return {
      kind: 'output',
      output: {
        content: parsed.reply,
        raw,
        toolCalls: parsed.toolCalls.map((call, index) => ({
          callId: `json-${input.round}-${index}`,
          toolId: call.id,
          input: call.args,
        })),
      },
    }
  }

  recordProtocolError(raw: string, repairPrompt: string): void {
    this.messages.push({ role: 'assistant', content: raw })
    this.messages.push({ role: 'user', content: repairPrompt })
  }

  recordContinuation(output: AgentHarnessModelOutput, continuationPrompt: string): void {
    this.messages.push({ role: 'assistant', content: output.raw })
    this.messages.push({ role: 'user', content: continuationPrompt })
  }

  recordUserPrompt(prompt: string): void {
    this.messages.push({ role: 'user', content: prompt })
  }

  recordToolResults(
    output: AgentHarnessModelOutput,
    exchanges: readonly AgentHarnessToolExchange<TObservation>[],
  ): void {
    this.messages.push({ role: 'assistant', content: output.raw })
    this.messages.push({
      role: 'user',
      content: this.options.renderToolResults(exchanges.map(({ observation }) => observation)),
    })
  }
}
