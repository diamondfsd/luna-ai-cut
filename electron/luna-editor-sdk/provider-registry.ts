import type {
  DeepSeekHarnessContext,
  DeepSeekHarnessToolDefinition,
  DeepSeekHarnessToolRequest,
} from '../../src/shared/types'
import {
  LUNA_EDITOR_SDK_API_VERSION,
  LunaEditorSdkError,
  type LunaEditorSdkContext,
  type LunaEditorSdkDispatchResult,
  type LunaEditorSdkProvider,
  type LunaEditorSdkRequest,
} from './contracts'

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/u
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/u
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*)+$/u

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new LunaEditorSdkError('ABORTED', 'Luna Editor SDK 能力调用已取消。')
  }
}

function validateProvider(provider: LunaEditorSdkProvider): void {
  if (!PROVIDER_ID_PATTERN.test(provider.id)) {
    throw new LunaEditorSdkError('INVALID_PROVIDER', `Luna Editor SDK Provider ID 无效：${provider.id}`)
  }
  if (!Array.isArray(provider.namespaces) || provider.namespaces.length === 0) {
    throw new LunaEditorSdkError('INVALID_PROVIDER', `Provider ${provider.id} 未声明能力命名空间。`)
  }
  const namespaces = new Set<string>()
  for (const namespace of provider.namespaces) {
    if (!NAMESPACE_PATTERN.test(namespace) || namespaces.has(namespace)) {
      throw new LunaEditorSdkError('INVALID_PROVIDER', `Provider ${provider.id} 的能力命名空间无效：${namespace}`)
    }
    namespaces.add(namespace)
  }
}

function validateCapabilityName(name: string): void {
  if (!CAPABILITY_PATTERN.test(name)) {
    throw new LunaEditorSdkError('INVALID_CAPABILITY', `Luna Editor SDK 能力名称无效：${name}`)
  }
}

function sdkContext(
  context: DeepSeekHarnessContext,
  request: DeepSeekHarnessToolRequest,
  signal: AbortSignal,
): LunaEditorSdkContext {
  return {
    ...context,
    apiVersion: LUNA_EDITOR_SDK_API_VERSION,
    requestId: request.requestId,
    signal,
  }
}

export class LunaEditorSdkProviderRegistry {
  private readonly providers = new Map<string, LunaEditorSdkProvider>()
  private readonly namespaceOwners = new Map<string, string>()

  register(provider: LunaEditorSdkProvider): () => void {
    validateProvider(provider)
    if (this.providers.has(provider.id)) {
      throw new LunaEditorSdkError('INVALID_PROVIDER', `Luna Editor SDK Provider 已注册：${provider.id}`)
    }
    for (const namespace of provider.namespaces) {
      const owner = this.namespaceOwners.get(namespace)
      if (owner) {
        throw new LunaEditorSdkError(
          'INVALID_PROVIDER',
          `能力命名空间 ${namespace} 已由 Provider ${owner} 注册。`,
        )
      }
    }

    this.providers.set(provider.id, provider)
    for (const namespace of provider.namespaces) this.namespaceOwners.set(namespace, provider.id)

    return () => this.unregister(provider.id, provider)
  }

  /**
   * Replace a host-owned implementation without leaving a registration gap.
   * This is used when the FreeCut renderer adapter becomes available after the
   * Electron module graph has been loaded.
   */
  replace(provider: LunaEditorSdkProvider): () => void {
    validateProvider(provider)
    const previous = this.providers.get(provider.id)
    if (previous) this.unregister(previous.id, previous)
    try {
      return this.register(provider)
    } catch (error) {
      if (previous) this.register(previous)
      throw error
    }
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId)
  }

  hasNamespace(namespace: string): boolean {
    return this.namespaceOwners.has(namespace)
  }

  listProviders(): Array<{ id: string; namespaces: string[] }> {
    return [...this.providers.values()].map((provider) => ({
      id: provider.id,
      namespaces: [...provider.namespaces],
    }))
  }

  getTools(context: DeepSeekHarnessContext): DeepSeekHarnessToolDefinition[] {
    const sdkContext = {
      ...context,
      apiVersion: LUNA_EDITOR_SDK_API_VERSION,
      requestId: 'capability-discovery',
      signal: new AbortController().signal,
    } satisfies LunaEditorSdkContext
    const tools: DeepSeekHarnessToolDefinition[] = []
    const names = new Set<string>()
    for (const provider of this.providers.values()) {
      for (const tool of provider.getTools(sdkContext)) {
        validateCapabilityName(tool.name)
        if (names.has(tool.name)) {
          throw new LunaEditorSdkError('INVALID_CAPABILITY', `能力名称重复：${tool.name}`)
        }
        const namespace = tool.name.split('.', 1)[0]
        if (!namespace || !provider.namespaces.includes(namespace)) {
          throw new LunaEditorSdkError(
            'INVALID_CAPABILITY',
            `Provider ${provider.id} 返回了未声明的能力：${tool.name}`,
          )
        }
        names.add(tool.name)
        tools.push(tool)
      }
    }
    return tools
  }

  async dispatch(
    request: LunaEditorSdkRequest,
    context: DeepSeekHarnessContext,
    signal: AbortSignal,
  ): Promise<LunaEditorSdkDispatchResult> {
    validateCapabilityName(request.name)
    assertNotAborted(signal)
    const namespace = request.name.split('.', 1)[0]
    const providerId = namespace ? this.namespaceOwners.get(namespace) : undefined
    const provider = providerId ? this.providers.get(providerId) : undefined
    if (!provider) {
      throw new LunaEditorSdkError(
        'CAPABILITY_UNAVAILABLE',
        `当前没有注册能力：${request.name}`,
        { capability: request.name, providers: this.listProviders() },
      )
    }
    const nextContext = sdkContext(context, request, signal)
    const result = await provider.execute(request, nextContext)
    assertNotAborted(signal)
    return {
      apiVersion: LUNA_EDITOR_SDK_API_VERSION,
      providerId: provider.id,
      capability: request.name,
      requestId: request.requestId,
      result,
    }
  }

  async execute(
    request: LunaEditorSdkRequest,
    context: DeepSeekHarnessContext,
    signal: AbortSignal,
  ): Promise<unknown> {
    const dispatched = await this.dispatch(request, context, signal)
    return dispatched.result
  }

  private unregister(providerId: string, provider: LunaEditorSdkProvider): void {
    if (this.providers.get(providerId) !== provider) return
    this.providers.delete(providerId)
    for (const namespace of provider.namespaces) {
      if (this.namespaceOwners.get(namespace) === providerId) this.namespaceOwners.delete(namespace)
    }
  }
}

export function toSdkRequest(request: DeepSeekHarnessToolRequest): LunaEditorSdkRequest {
  return {
    ...request,
    args: { ...request.args },
  }
}
