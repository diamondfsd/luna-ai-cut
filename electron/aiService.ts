import OpenAI from 'openai'
import type { AiConfig } from '../src/shared/types'

let client: OpenAI | null = null
let currentConfig: AiConfig | null = null

function getClient(config: AiConfig): OpenAI {
  if (client && currentConfig?.baseUrl === config.baseUrl && currentConfig?.apiKey === config.apiKey) {
    return client
  }
  currentConfig = config
  client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })
  return client
}

export async function chatCompletion(
  config: AiConfig,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const openai = getClient(config)
  const response = await openai.chat.completions.create({
    model: config.model || 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature: 0.7,
  })
  return response.choices[0]?.message?.content ?? ''
}
