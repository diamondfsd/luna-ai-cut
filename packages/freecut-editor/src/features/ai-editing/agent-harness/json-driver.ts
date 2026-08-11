import type { LlmAdapter, LlmGenerateOptions, LlmMessage } from '@freecut/infrastructure/llm'
import type { AiEditingResponse } from '../types'
import type {
  AgentHarnessDriver,
  AgentHarnessModelOutput,
  AgentHarnessModelStep,
  AgentHarnessToolExchange,
} from './types'

interface JsonAgentDriverOptions<TObservation> {
  adapter: LlmAdapter
  messages: LlmMessage[]
  parse(raw: string): AiEditingResponse | null
  renderToolResults(observations: readonly TObservation[]): string
  requestOptions(round: number): LlmGenerateOptions
  initialRaw?: string
}

export class JsonAgentDriver<TObservation> implements AgentHarnessDriver<TObservation> {
  readonly protocol = 'json'
  private readonly messages: LlmMessage[]
  private initialRaw: string | undefined

  constructor(private readonly options: JsonAgentDriverOptions<TObservation>) {
    this.messages = options.messages
    this.initialRaw = options.initialRaw
  }

  get messageCount(): number {
    return this.messages.length
  }

  async request(input: { round: number; instructions: string }): Promise<AgentHarnessModelStep> {
    this.replaceInstructions(input.instructions)
    const raw = this.initialRaw ?? await this.options.adapter.generate(
      this.messages,
      this.options.requestOptions(input.round),
    )
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

  private replaceInstructions(instructions: string): void {
    const first = this.messages[0]
    if (first?.role === 'system') {
      first.content = instructions
      return
    }
    this.messages.unshift({ role: 'system', content: instructions })
  }
}
