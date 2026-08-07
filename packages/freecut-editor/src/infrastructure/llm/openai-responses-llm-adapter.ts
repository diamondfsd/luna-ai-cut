import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types'

const DEFAULT_MAX_TOKENS = 768

function abortedError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

class OpenAiResponsesLlmAdapter implements LlmAdapter {
  readonly id = 'openai-responses'
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
      const text = await bridge.generate({
        requestId,
        messages,
        maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? 0,
      })
      if (signal?.aborted) throw abortedError()
      options.onToken?.(text, text)
      return text
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  dispose(): void {
    // Requests are individually cancelled by their AbortSignal.
  }
}

export const openAiResponsesLlmAdapter: LlmAdapter = new OpenAiResponsesLlmAdapter()
