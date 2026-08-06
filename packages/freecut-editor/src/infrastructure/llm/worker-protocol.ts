/**
 * Message protocol shared between the main-thread adapter and the on-device
 * LLM worker. Kept in its own module (no `?worker` import) so both sides can
 * import the types without pulling in the worker bundle.
 */

export interface LlmWorkerLoadRequest {
  type: 'load'
}

export interface LlmWorkerGenerateRequest {
  type: 'generate'
  /** Correlates streamed tokens + the result/error back to one call. */
  id: number
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  maxTokens: number
  temperature: number
  topP: number
}

export interface LlmWorkerCancelRequest {
  type: 'cancel'
  id: number
}

export interface LlmWorkerDisposeRequest {
  type: 'dispose'
}

export type LlmWorkerRequest =
  | LlmWorkerLoadRequest
  | LlmWorkerGenerateRequest
  | LlmWorkerCancelRequest
  | LlmWorkerDisposeRequest

export interface LlmWorkerProgressMessage {
  type: 'progress'
  stage: string
  percent: number
}

export interface LlmWorkerReadyMessage {
  type: 'ready'
}

export interface LlmWorkerTokenMessage {
  type: 'token'
  id: number
  delta: string
}

export interface LlmWorkerResultMessage {
  type: 'result'
  id: number
  text: string
}

export interface LlmWorkerErrorMessage {
  type: 'error'
  /** Present for generate errors; absent for load errors. */
  id?: number
  message: string
}

export interface LlmWorkerDisposedMessage {
  type: 'disposed'
}

export type LlmWorkerResponse =
  | LlmWorkerProgressMessage
  | LlmWorkerReadyMessage
  | LlmWorkerTokenMessage
  | LlmWorkerResultMessage
  | LlmWorkerErrorMessage
  | LlmWorkerDisposedMessage
