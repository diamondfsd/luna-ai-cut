/**
 * Local LLM adapter contract.
 *
 * FreeCut runs language models fully on-device (WebGPU/WASM) to stay
 * privacy-first and offline-capable. The {@link LlmAdapter} interface is the
 * single seam every consumer (the editing agent, future features) talks to, so
 * the concrete model — today Gemma via transformers.js — can be swapped for a
 * stronger local WebGPU model without touching callers. Register new adapters
 * in `llm-registry.ts`.
 */

export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmMessage {
  role: LlmRole
  content: string
}

export interface LlmLoadProgress {
  /** Coarse loading stage label, e.g. `loading-model`. */
  stage: string
  /** 0–100. */
  percent: number
}

export interface LlmRequestStatus {
  attempt: number
  maxAttempts: number
  state: 'waiting' | 'retrying' | 'streaming'
  previewText?: string
  previewKind?: 'reasoning' | 'content'
}

export interface LlmTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
}

export interface LlmGenerateOptions {
  /** Hard cap on generated tokens. Adapters pick a sensible default. */
  maxTokens?: number
  /** 0 = greedy/deterministic (default). >0 enables sampling. */
  temperature?: number
  /** Nucleus sampling cutoff when `temperature > 0`. */
  topP?: number
  /** Remote reasoning depth. Local adapters may ignore this preference. */
  reasoningEffort?: 'low' | 'high' | 'xhigh' | 'max'
  /** Abort streaming and reject the pending generation. */
  signal?: AbortSignal
  /**
   * Streaming callback. `delta` is the newly decoded text, `text` the full
   * accumulated output so far. Fired on the main thread.
   */
  onToken?: (delta: string, text: string) => void
  /** Actual token usage returned by the model provider, when available. */
  onUsage?: (usage: LlmTokenUsage) => void
  /** Reports remote request attempts so callers can show useful waiting feedback. */
  onStatus?: (status: LlmRequestStatus) => void
}

export interface LlmAdapter {
  /** Stable id used by the registry (e.g. `gemma`). */
  readonly id: string
  /** Human-facing label, e.g. `Gemma 4 (on-device)`. */
  readonly label: string
  /** Whether this adapter can run in the current browser (e.g. WebGPU present). */
  isSupported(): boolean
  /**
   * Begin loading model weights; resolves once ready. Safe to call repeatedly —
   * concurrent/duplicate calls share the same in-flight load.
   */
  load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void>
  /** Run a chat completion. Resolves with the full text (also streamed via `onToken`). */
  generate(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string>
  /** Release weights / terminate the worker to free VRAM. */
  dispose(): void
}
