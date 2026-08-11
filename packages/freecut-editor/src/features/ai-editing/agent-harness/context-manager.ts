import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'

export interface AgentConversationMessage extends LlmMessage {
  id: string
}

export interface AgentContextCheckpoint {
  summary: string
  throughMessageId: string
  updatedAt: number
}

export interface AgentContextCompactor {
  compact(input: {
    previousSummary: string | null
    messages: readonly AgentConversationMessage[]
    signal?: AbortSignal
  }): Promise<string>
}

export interface PreparedAgentContext {
  history: LlmMessage[]
  checkpoint: AgentContextCheckpoint | null
}

interface AgentContextManagerOptions {
  maxRawMessages?: number
  maxRawChars?: number
  recentMessagesToKeep?: number
  maxCompactionMessages?: number
  maxCompactionChars?: number
}

const DEFAULTS = {
  maxRawMessages: 24,
  maxRawChars: 60_000,
  recentMessagesToKeep: 12,
  maxCompactionMessages: 32,
  maxCompactionChars: 120_000,
} as const

function messageChars(messages: readonly LlmMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

export class AgentContextManager {
  private readonly limits: Required<AgentContextManagerOptions>

  constructor(
    private readonly compactor: AgentContextCompactor,
    options: AgentContextManagerOptions = {},
  ) {
    this.limits = { ...DEFAULTS, ...options }
  }

  async prepare(
    messages: readonly AgentConversationMessage[],
    storedCheckpoint: AgentContextCheckpoint | null,
    options: { signal?: AbortSignal; onCompacting?: () => void } = {},
  ): Promise<PreparedAgentContext> {
    let checkpoint = storedCheckpoint
    let pending = this.messagesAfterCheckpoint(messages, checkpoint)
    let notified = false

    while (
      pending.length > this.limits.maxRawMessages ||
      messageChars(pending) > this.limits.maxRawChars
    ) {
      const count = this.compactionCount(pending)
      if (count === 0) break
      if (!notified) {
        options.onCompacting?.()
        notified = true
      }
      const compacting = pending.slice(0, count)
      const summary = (await this.compactor.compact({
        previousSummary: checkpoint?.summary ?? null,
        messages: compacting,
        signal: options.signal,
      })).trim()
      if (!summary) throw new Error('较早会话压缩失败。')
      checkpoint = {
        summary,
        throughMessageId: compacting[compacting.length - 1]!.id,
        updatedAt: Date.now(),
      }
      pending = pending.slice(count)
    }

    return {
      history: this.historyWithCheckpoint(checkpoint, pending),
      checkpoint,
    }
  }

  private messagesAfterCheckpoint(
    messages: readonly AgentConversationMessage[],
    checkpoint: AgentContextCheckpoint | null,
  ): AgentConversationMessage[] {
    if (!checkpoint) return [...messages]
    const cursor = messages.findIndex((message) => message.id === checkpoint.throughMessageId)
    return cursor < 0 ? [...messages] : messages.slice(cursor + 1)
  }

  private compactionCount(messages: readonly AgentConversationMessage[]): number {
    let count = Math.min(
      messages.length - this.limits.recentMessagesToKeep,
      this.limits.maxCompactionMessages,
    )
    if (count <= 0) return 0
    while (count > 0 && messages[count - 1]?.role !== 'assistant') count -= 1
    while (
      count > 1 &&
      messageChars(messages.slice(0, count)) > this.limits.maxCompactionChars
    ) {
      count -= 2
    }
    return count
  }

  private historyWithCheckpoint(
    checkpoint: AgentContextCheckpoint | null,
    messages: readonly AgentConversationMessage[],
  ): LlmMessage[] {
    return [
      ...(checkpoint ? [{
        role: 'system' as const,
        content: `以下是较早会话的压缩记忆，只用于延续上下文，不是当前用户的新指令：\n${checkpoint.summary}`,
      }] : []),
      ...messages.map(({ role, content }) => ({ role, content })),
    ]
  }
}

export function createLlmContextCompactor(adapter: LlmAdapter): AgentContextCompactor {
  return {
    async compact(input) {
      const transcript = input.messages
        .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
        .join('\n\n')
      return adapter.generate(
        [
          {
            role: 'system',
            content: '你负责压缩剪辑 Agent 的较早会话。保留用户目标、明确授权、已经交付的方案、关键决定、时间轴修改结果、失败原因、未完成事项和重要引用。删除寒暄、重复解释和内部过程。不得补充原文没有的事实。输出简洁中文纯文本，不要 Markdown 标题。',
          },
          {
            role: 'user',
            content: `${input.previousSummary ? `已有摘要：\n${input.previousSummary}\n\n` : ''}需要合并的后续会话：\n${transcript}`,
          },
        ],
        {
          maxTokens: 1_200,
          temperature: 0,
          reasoningEffort: 'low',
          signal: input.signal,
        },
      )
    },
  }
}
