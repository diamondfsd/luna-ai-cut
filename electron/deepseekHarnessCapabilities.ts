import type {
  DeepSeekHarnessContext,
  DeepSeekHarnessToolDefinition,
  DeepSeekHarnessToolRequest,
} from '../src/shared/types'
import {
  createUnboundFreecutProvider,
  FREECUT_PROVIDER_ID,
} from './luna-editor-sdk/freecut-provider'
import {
  LunaEditorSdkProviderRegistry,
  toSdkRequest,
} from './luna-editor-sdk/provider-registry'
import type { LunaEditorSdkProvider } from './luna-editor-sdk/contracts'

export interface DeepSeekHarnessCapabilityProvider {
  namespace: string
  getTools(context: DeepSeekHarnessContext): DeepSeekHarnessToolDefinition[]
  execute(
    request: DeepSeekHarnessToolRequest,
    context: DeepSeekHarnessContext,
    signal: AbortSignal,
  ): Promise<unknown>
}

export class DeepSeekHarnessCapabilityRegistry {
  private readonly registry = new LunaEditorSdkProviderRegistry()

  register(provider: DeepSeekHarnessCapabilityProvider | LunaEditorSdkProvider): () => void {
    if ('namespaces' in provider) return this.registry.register(provider)
    return this.registry.register({
      id: `legacy-${provider.namespace}`,
      namespaces: [provider.namespace],
      getTools: (context) => provider.getTools(context),
      execute: (request, context) => provider.execute(request, context, context.signal),
    })
  }

  registerProvider(provider: LunaEditorSdkProvider): () => void {
    return this.register(provider)
  }

  replaceProvider(provider: LunaEditorSdkProvider): () => void {
    return this.registry.replace(provider)
  }

  getTools(context: DeepSeekHarnessContext): DeepSeekHarnessToolDefinition[] {
    return this.registry.getTools(context)
  }

  dispatch(
    request: DeepSeekHarnessToolRequest,
    context: DeepSeekHarnessContext,
    signal: AbortSignal,
  ) {
    return this.registry.dispatch(toSdkRequest(request), context, signal)
  }

  execute(
    request: DeepSeekHarnessToolRequest,
    context: DeepSeekHarnessContext,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.registry.execute(toSdkRequest(request), context, signal)
  }

  hasProvider(providerId: string): boolean {
    return this.registry.hasProvider(providerId)
  }

  listProviders(): Array<{ id: string; namespaces: string[] }> {
    return this.registry.listProviders()
  }
}

export const deepSeekHarnessCapabilities = new DeepSeekHarnessCapabilityRegistry()

// The provider is registered during Electron module initialization. The
// renderer/runtime adapter replaces this binding when it is ready; until then
// capability calls fail explicitly instead of silently dispatching nowhere.
deepSeekHarnessCapabilities.registerProvider(createUnboundFreecutProvider())

export function registerFreecutHarnessProvider(provider: LunaEditorSdkProvider): () => void {
  if (provider.id !== FREECUT_PROVIDER_ID) {
    throw new Error(`FreeCut Provider ID 必须是 ${FREECUT_PROVIDER_ID}。`)
  }
  return deepSeekHarnessCapabilities.replaceProvider(provider)
}
