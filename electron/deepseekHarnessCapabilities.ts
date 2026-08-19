import type {
  DeepSeekHarnessContext,
  DeepSeekHarnessToolDefinition,
  DeepSeekHarnessToolRequest,
} from '../src/shared/types'

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
  private readonly providers = new Map<string, DeepSeekHarnessCapabilityProvider>()

  register(provider: DeepSeekHarnessCapabilityProvider): () => void {
    if (!/^[a-z][a-z0-9-]*$/u.test(provider.namespace)) {
      throw new Error(`助手能力命名空间无效：${provider.namespace}`)
    }
    if (this.providers.has(provider.namespace)) {
      throw new Error(`助手能力命名空间已注册：${provider.namespace}`)
    }
    this.providers.set(provider.namespace, provider)
    return () => {
      if (this.providers.get(provider.namespace) === provider) {
        this.providers.delete(provider.namespace)
      }
    }
  }

  getTools(context: DeepSeekHarnessContext): DeepSeekHarnessToolDefinition[] {
    return [...this.providers.values()].flatMap((provider) => provider.getTools(context))
  }

  execute(
    request: DeepSeekHarnessToolRequest,
    context: DeepSeekHarnessContext,
    signal: AbortSignal,
  ): Promise<unknown> {
    const namespace = request.name.split('.', 1)[0]
    const provider = namespace ? this.providers.get(namespace) : undefined
    if (!provider) {
      throw new Error(`当前没有可用的助手能力：${request.name}`)
    }
    return provider.execute(request, context, signal)
  }
}

export const deepSeekHarnessCapabilities = new DeepSeekHarnessCapabilityRegistry()
