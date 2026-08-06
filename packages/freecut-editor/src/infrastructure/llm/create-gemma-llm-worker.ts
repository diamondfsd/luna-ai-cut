/**
 * Factory for the on-device Gemma text LLM worker.
 *
 * Uses Vite's explicit `?worker` import so the worker entry is emitted with the
 * correct module URL and MIME type in both dev and production (mirrors
 * `create-gemma-worker.ts`).
 */
import GemmaLlmWorker from './gemma-llm-worker.ts?worker'

export function createGemmaLlmWorker(): Worker {
  return new GemmaLlmWorker()
}
