import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { AiEditingAssistantTokenUsage } from '../src/shared/types'

const MAX_PREVIEW_LENGTH = 4_000

export interface AiEditingAssistantStreamResult {
  content: string
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  usage?: AiEditingAssistantTokenUsage
}

export interface AiEditingAssistantStreamPreview {
  text: string
  kind: 'reasoning' | 'content'
}

export type AiEditingAssistantContentPreviewMode = 'raw' | 'json-reply'

interface PartialJsonString {
  text: string
  complete: boolean
}

function findTopLevelReplyValueStart(value: string): number | null {
  const objectStart = value.indexOf('{')
  if (objectStart < 0) return null

  let depth = 0
  let expectTopLevelKey = false
  let inString = false
  let escaped = false
  let stringStart = -1

  for (let index = objectStart; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character !== '"') continue

      inString = false
      if (!expectTopLevelKey) continue
      expectTopLevelKey = false

      let key: unknown
      try {
        key = JSON.parse(value.slice(stringStart, index + 1))
      } catch {
        continue
      }
      if (key !== 'reply') continue

      let cursor = index + 1
      while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1
      if (value[cursor] !== ':') continue
      cursor += 1
      while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1
      return value[cursor] === '"' ? cursor + 1 : null
    }

    if (character === '"') {
      inString = true
      stringStart = index
      continue
    }
    if (character === '{' || character === '[') {
      depth += 1
      if (character === '{' && depth === 1) expectTopLevelKey = true
      continue
    }
    if (character === '}' || character === ']') {
      depth -= 1
      continue
    }
    if (character === ',' && depth === 1) expectTopLevelKey = true
  }

  return null
}

function decodePartialJsonString(value: string, start: number): PartialJsonString {
  let text = ''
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') return { text, complete: true }
    if (character !== '\\') {
      text += character
      continue
    }

    const escape = value[index + 1]
    if (escape === undefined) break
    const escapedCharacters: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    }
    if (escape === 'u') {
      const hex = value.slice(index + 2, index + 6)
      if (hex.length < 4) break
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
      text += String.fromCharCode(Number.parseInt(hex, 16))
      index += 5
      continue
    }
    const decoded = escapedCharacters[escape]
    if (decoded === undefined) break
    text += decoded
    index += 1
  }
  return { text, complete: false }
}

function createContentPreview(mode: AiEditingAssistantContentPreviewMode): (value: string) => string | null {
  if (mode === 'raw') return (value) => value

  let replyStart: number | null = null
  let completedReply: string | null = null
  return (value) => {
    if (completedReply !== null) return completedReply
    replyStart ??= findTopLevelReplyValueStart(value)
    if (replyStart === null) return null
    const reply = decodePartialJsonString(value, replyStart)
    if (reply.complete) completedReply = reply.text
    return reply.text
  }
}

function reasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return ''
  const candidate = delta as { reasoning_content?: unknown; reasoning?: unknown }
  if (typeof candidate.reasoning_content === 'string') return candidate.reasoning_content
  return typeof candidate.reasoning === 'string' ? candidate.reasoning : ''
}

function reasoningPreview(value: string): string {
  return value.slice(-MAX_PREVIEW_LENGTH)
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function normalizeUsage(usage: ChatCompletionChunk['usage']): AiEditingAssistantTokenUsage | undefined {
  if (!usage) return undefined
  const promptTokens = tokenCount(usage.prompt_tokens)
  const completionTokens = tokenCount(usage.completion_tokens)
  const totalTokens = tokenCount(usage.total_tokens)
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
    return undefined
  }
  const cachedValue = usage.prompt_tokens_details?.cached_tokens
  const cachedTokens = cachedValue === undefined ? 0 : tokenCount(cachedValue)
  if (cachedTokens === undefined || cachedTokens > promptTokens) return undefined
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
  }
}

export async function consumeAiEditingAssistantStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  options: {
    onActivity?: () => void
    onPreview?: (preview: AiEditingAssistantStreamPreview) => void
    contentPreviewMode?: AiEditingAssistantContentPreviewMode
  } = {},
): Promise<AiEditingAssistantStreamResult> {
  let content = ''
  let reasoning = ''
  let usage: AiEditingAssistantTokenUsage | undefined
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
  const contentPreview = createContentPreview(options.contentPreviewMode ?? 'raw')

  for await (const chunk of stream) {
    options.onActivity?.()
    usage = normalizeUsage(chunk.usage) ?? usage
    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    const nextReasoning = reasoningDelta(delta)
    if (nextReasoning) reasoning += nextReasoning
    if (typeof delta.content === 'string') content += delta.content

    for (const toolCall of delta.tool_calls ?? []) {
      const current = toolCalls.get(toolCall.index) ?? { id: '', name: '', arguments: '' }
      toolCalls.set(toolCall.index, {
        id: toolCall.id ?? current.id,
        name: current.name + (toolCall.function?.name ?? ''),
        arguments: current.arguments + (toolCall.function?.arguments ?? ''),
      })
    }

    if (content) {
      const preview = contentPreview(content)
      if (preview !== null) options.onPreview?.({ text: preview, kind: 'content' })
    } else if (reasoning) {
      options.onPreview?.({ text: reasoningPreview(reasoning), kind: 'reasoning' })
    }
  }

  return {
    content: content.trim(),
    toolCalls: [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall),
    ...(usage ? { usage } : {}),
  }
}
