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

export type AgentHarnessModelStep =
  | { kind: 'output'; output: AgentHarnessModelOutput }
  | { kind: 'protocol-error'; raw: string }
  | { kind: 'fallback'; content?: string }

export interface AgentHarnessToolExchange<TObservation> {
  call: AgentHarnessToolCall
  observation: TObservation
}

export interface AgentHarnessDriver<TObservation> {
  readonly protocol: string
  readonly messageCount: number
  request(input: { round: number; instructions: string }): Promise<AgentHarnessModelStep>
  recordProtocolError(raw: string, repairPrompt: string): void
  recordContinuation(output: AgentHarnessModelOutput, continuationPrompt: string): void
  recordToolResults(
    output: AgentHarnessModelOutput,
    exchanges: readonly AgentHarnessToolExchange<TObservation>[],
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
  instructions(): Promise<string>
  executeTool(call: AgentHarnessToolCall, callIndex: number): Promise<TObservation>
  canCompleteFromText(input: {
    output: AgentHarnessModelOutput
    observations: readonly TObservation[]
  }): boolean
  shouldStopAfterTool(observations: readonly TObservation[]): boolean
  canRecoverFromModelError(observations: readonly TObservation[]): boolean
  onTextCompletion?(content: string): void
  onEvent?(event: AgentHarnessEvent<TObservation>): void
}
