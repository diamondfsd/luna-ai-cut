/**
 * Registry of local LLM adapters. This is the swap point: to move the agent to
 * a stronger on-device WebGPU model, implement {@link LlmAdapter}, register it
 * here, and (optionally) change the default id. Callers resolve adapters by id
 * and never import a concrete implementation directly.
 */

import { ProviderRegistry } from '@freecut/shared/utils/provider-registry'
import { gemmaLlmAdapter } from './gemma-llm-adapter'
import type { LlmAdapter } from './types'

export const DEFAULT_LLM_ADAPTER_ID = 'gemma'

const llmAdapterRegistry = new ProviderRegistry<LlmAdapter>(
  [gemmaLlmAdapter],
  DEFAULT_LLM_ADAPTER_ID,
)

export function getDefaultLlmAdapter(): LlmAdapter {
  return llmAdapterRegistry.getDefault()
}

export function getLlmAdapter(id: string): LlmAdapter {
  return llmAdapterRegistry.get(id)
}

export function listLlmAdapters(): readonly LlmAdapter[] {
  return llmAdapterRegistry.list()
}
