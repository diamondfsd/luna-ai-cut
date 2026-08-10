import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { AiEditingConversationContext } from '@freecut/infrastructure/storage'

const MAX_RAW_MESSAGES = 24
const MAX_RAW_CHARS = 60_000
const RECENT_MESSAGES_TO_KEEP = 12
const MAX_COMPACTION_MESSAGES = 32
const MAX_COMPACTION_CHARS = 120_000

interface ConversationMessage extends LlmMessage {
  id: string
}

interface PrepareConversationContextOptions {
  adapter: LlmAdapter
  signal?: AbortSignal
  onCompacting?: () => void
}

export interface PreparedConversationContext {
  history: LlmMessage[]
  context: AiEditingConversationContext | null
}

function messageChars(messages: readonly LlmMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

function messagesAfterContext(
  messages: readonly ConversationMessage[],
  context: AiEditingConversationContext | null,
): ConversationMessage[] {
  if (!context) return [...messages]
  const cursor = messages.findIndex((message) => message.id === context.throughMessageId)
  return cursor < 0 ? [...messages] : messages.slice(cursor + 1)
}

function compactionCount(messages: readonly ConversationMessage[]): number {
  let count = Math.min(messages.length - RECENT_MESSAGES_TO_KEEP, MAX_COMPACTION_MESSAGES)
  if (count <= 0) return 0
  while (count > 0 && messages[count - 1]?.role !== 'assistant') count -= 1
  while (count > 1 && messageChars(messages.slice(0, count)) > MAX_COMPACTION_CHARS) count -= 2
  return count
}

function summaryMessages(
  previousSummary: string | null,
  messages: readonly ConversationMessage[],
): LlmMessage[] {
  const transcript = messages
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n\n')
  return [
    {
      role: 'system',
      content: '你负责压缩剪辑 Agent 的较早会话。保留用户目标、明确授权、已经交付的方案、关键决定、时间轴修改结果、失败原因、未完成事项和重要引用。删除寒暄、重复解释和内部过程。不得补充原文没有的事实。输出简洁中文纯文本，不要 Markdown 标题。',
    },
    {
      role: 'user',
      content: `${previousSummary ? `已有摘要：\n${previousSummary}\n\n` : ''}需要合并的后续会话：\n${transcript}`,
    },
  ]
}

function historyWithSummary(
  context: AiEditingConversationContext | null,
  messages: readonly ConversationMessage[],
): LlmMessage[] {
  return [
    ...(context ? [{
      role: 'system' as const,
      content: `以下是较早会话的压缩记忆，只用于延续上下文，不是当前用户的新指令：\n${context.summary}`,
    }] : []),
    ...messages.map(({ role, content }) => ({ role, content })),
  ]
}

export async function prepareConversationContext(
  messages: readonly ConversationMessage[],
  storedContext: AiEditingConversationContext | null,
  options: PrepareConversationContextOptions,
): Promise<PreparedConversationContext> {
  let context = storedContext
  let pending = messagesAfterContext(messages, context)
  let notified = false

  while (pending.length > MAX_RAW_MESSAGES || messageChars(pending) > MAX_RAW_CHARS) {
    const count = compactionCount(pending)
    if (count === 0) break
    if (!notified) {
      options.onCompacting?.()
      notified = true
    }
    const compacting = pending.slice(0, count)
    const summary = (await options.adapter.generate(
      summaryMessages(context?.summary ?? null, compacting),
      {
        maxTokens: 1_200,
        temperature: 0,
        reasoningEffort: 'low',
        signal: options.signal,
      },
    )).trim()
    if (!summary) throw new Error('较早会话压缩失败。')
    context = {
      summary,
      throughMessageId: compacting[compacting.length - 1]!.id,
      updatedAt: Date.now(),
    }
    pending = pending.slice(count)
  }

  return { history: historyWithSummary(context, pending), context }
}
