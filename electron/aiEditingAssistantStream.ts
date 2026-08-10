import type { ChatCompletionChunk } from 'openai/resources/chat/completions'

const MAX_PREVIEW_LENGTH = 4_000

export interface AiEditingAssistantStreamResult {
  content: string
  toolCalls: Array<{ id: string; name: string; arguments: string }>
}

export interface AiEditingAssistantStreamPreview {
  text: string
  kind: 'reasoning' | 'content'
}

function reasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return ''
  const candidate = delta as { reasoning_content?: unknown; reasoning?: unknown }
  if (typeof candidate.reasoning_content === 'string') return candidate.reasoning_content
  return typeof candidate.reasoning === 'string' ? candidate.reasoning : ''
}

function previewTail(value: string): string {
  return value.slice(-MAX_PREVIEW_LENGTH)
}

export async function consumeAiEditingAssistantStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  options: {
    onActivity?: () => void
    onPreview?: (preview: AiEditingAssistantStreamPreview) => void
  } = {},
): Promise<AiEditingAssistantStreamResult> {
  let content = ''
  let reasoning = ''
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

  for await (const chunk of stream) {
    options.onActivity?.()
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
      options.onPreview?.({ text: previewTail(content), kind: 'content' })
    } else if (reasoning) {
      options.onPreview?.({ text: previewTail(reasoning), kind: 'reasoning' })
    }
  }

  return {
    content: content.trim(),
    toolCalls: [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall),
  }
}
