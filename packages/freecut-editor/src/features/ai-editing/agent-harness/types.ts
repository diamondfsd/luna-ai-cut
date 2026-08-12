import type { LlmMessage } from '@freecut/infrastructure/llm'
import type {
  EmbeddedAiAssistantMessage,
  EmbeddedAiAssistantToolDefinition,
} from '@freecut/shared/host/embedded-host'

export type AgentHarnessModelRequest =
  | {
      protocol: 'json'
      round: number
      messages: LlmMessage[]
      generation: AgentHarnessGenerationParameters
    }
  | {
      protocol: 'native'
      round: number
      messages: EmbeddedAiAssistantMessage[]
      tools: EmbeddedAiAssistantToolDefinition[]
      generation: AgentHarnessGenerationParameters
    }

export interface AgentHarnessGenerationParameters {
  maxTokens?: number
  temperature?: number
  topP?: number
  reasoningEffort?: 'low' | 'high' | 'xhigh' | 'max'
}

export interface AgentHarnessToolCall {
  callId: string
  toolId: string
  input: unknown
}

export interface AgentHarnessModelOutput {
  content: string
  raw: string
  toolCalls: AgentHarnessToolCall[]
}

export type AgentReplayMessage = EmbeddedAiAssistantMessage

export interface AiEditingAgentTurn {
  id: string
  protocol: 'native' | 'json'
  messages: AgentReplayMessage[]
}

export type AgentHarnessModelStep =
  | { kind: 'output'; output: AgentHarnessModelOutput }
  | { kind: 'protocol-error'; raw: string }
  | { kind: 'fallback'; content?: string }

export interface AgentHarnessToolExchange<TObservation> {
  call: AgentHarnessToolCall
  observation: TObservation
}

export interface AgentHarnessDriver<TObservation> {
  readonly protocol: 'native' | 'json'
  readonly messageCount: number
  readonly replayMessages: AgentReplayMessage[]
  request(input: { round: number }): Promise<AgentHarnessModelStep>
  recordProtocolError(raw: string, repairPrompt: string): void
  recordContinuation(output: AgentHarnessModelOutput, continuationPrompt: string): void
  recordFinalOutput(output: AgentHarnessModelOutput): void
  recordUserPrompt(prompt: string): void
  recordToolResults(
    output: AgentHarnessModelOutput,
    exchanges: readonly AgentHarnessToolExchange<TObservation>[],
    continueAfterTools?: boolean,
  ): void
}

export type AgentHarnessEvent<TObservation> =
  | { type: 'model-request'; round: number; protocol: string; messageCount: number }
  | { type: 'model-response'; round: number; protocol: string; step: AgentHarnessModelStep }
  | { type: 'model-error'; round: number; protocol: string; error: unknown }
  | { type: 'protocol-error'; round: number; protocol: string }
  | { type: 'tool-start'; round: number; call: AgentHarnessToolCall }
  | {
      type: 'tool-result'
      round: number
      exchange: AgentHarnessToolExchange<TObservation>
    }

export interface AgentHarnessResult<TObservation> {
  status: 'completed' | 'exhausted' | 'fallback'
  reply: string
  observations: TObservation[]
  protocol: 'native' | 'json'
  replayMessages: AgentReplayMessage[]
  fallbackContent?: string
}

export interface RunAgentHarnessOptions<TObservation> {
  driver: AgentHarnessDriver<TObservation>
  maxRounds: number
  maxToolCallsPerRound: number
  initialObservations?: readonly TObservation[]
  signal?: AbortSignal
  protocolRepairPrompt: string
  continuationPrompt: string
  finalizationPrompt: string
  executeTool(call: AgentHarnessToolCall, callIndex: number, round: number): Promise<TObservation>
  onTextCompletion?(content: string): void
  onEvent?(event: AgentHarnessEvent<TObservation>): void
}
