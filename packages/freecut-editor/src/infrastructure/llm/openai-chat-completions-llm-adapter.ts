import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type {
  EmbeddedAiAssistantGenerateResult,
  EmbeddedAiAssistantMessage,
  EmbeddedAiAssistantToolDefinition,
} from '@freecut/shared/host/embedded-host'
import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types'

const DEFAULT_MAX_TOKENS = 768

function abortedError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export interface NativeToolCallingLlmAdapter extends LlmAdapter {
  generateWithTools(
    messages: EmbeddedAiAssistantMessage[],
    tools: EmbeddedAiAssistantToolDefinition[],
    options?: LlmGenerateOptions,
  ): Promise<EmbeddedAiAssistantGenerateResult>
}

class OpenAiChatCompletionsLlmAdapter implements NativeToolCallingLlmAdapter {
  readonly id = 'openai-chat-completions'
  readonly label = '远端剪辑助手'

  isSupported(): boolean {
    return Boolean(getEmbeddedHostBridge().aiAssistant)
  }

  async load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void> {
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) throw new Error('当前环境不支持剪辑助手模型连接。')
    onProgress?.({ stage: 'connecting', percent: 35 })
    const config = await bridge.getConfig()
    if (!config.hasApiKey || !config.baseUrl || !config.model) {
      throw new Error('请先配置剪辑助手模型连接。')
    }
    onProgress?.({ stage: 'ready', percent: 100 })
  }

  async generate(messages: LlmMessage[], options: LlmGenerateOptions = {}): Promise<string> {
    await this.load()
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) throw new Error('当前环境不支持剪辑助手模型连接。')

    const requestId = crypto.randomUUID()
    const signal = options.signal
    if (signal?.aborted) throw abortedError()

    const cancel = (): void => {
      void bridge.cancel(requestId)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const result = await bridge.generate({
        requestId,
        messages,
        mode: 'json',
        maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? 0,
        reasoningEffort: options.reasoningEffort ?? 'high',
      })
      if (signal?.aborted) throw abortedError()
      const text = result.content
      if (!text) throw new Error('剪辑助手没有返回内容，请重试。')
      options.onToken?.(text, text)
      return text
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  async generateWithTools(
    messages: EmbeddedAiAssistantMessage[],
    tools: EmbeddedAiAssistantToolDefinition[],
    options: LlmGenerateOptions = {},
  ): Promise<EmbeddedAiAssistantGenerateResult> {
    await this.load()
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) throw new Error('当前环境不支持剪辑助手模型连接。')

    const requestId = crypto.randomUUID()
    const signal = options.signal
    if (signal?.aborted) throw abortedError()

    const cancel = (): void => {
      void bridge.cancel(requestId)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const result = await bridge.generate({
        requestId,
        messages,
        tools,
        mode: 'auto',
        maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? 0,
        reasoningEffort: options.reasoningEffort ?? 'high',
      })
      if (signal?.aborted) throw abortedError()
      return result
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  dispose(): void {
    // Requests are individually cancelled by their AbortSignal.
  }
}

export function supportsNativeToolCalling(adapter: LlmAdapter): adapter is NativeToolCallingLlmAdapter {
  return adapter instanceof OpenAiChatCompletionsLlmAdapter
}

export const openAiChatCompletionsLlmAdapter: NativeToolCallingLlmAdapter = new OpenAiChatCompletionsLlmAdapter()
