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
  contextWindowTokens: number
  lastPromptTokens?: number | null
  compactionThresholdRatio?: number
  recentMessagesToKeep?: number
  maxCompactionMessages?: number
}

const DEFAULTS = {
  compactionThresholdRatio: 0.8,
  recentMessagesToKeep: 12,
  maxCompactionMessages: 32,
} as const

export class AgentContextManager {
  private readonly limits: Required<AgentContextManagerOptions>

  constructor(
    private readonly compactor: AgentContextCompactor,
    options: AgentContextManagerOptions,
  ) {
    this.limits = {
      ...DEFAULTS,
      ...options,
      lastPromptTokens: options.lastPromptTokens ?? null,
    }
    if (!Number.isSafeInteger(this.limits.contextWindowTokens) ||
      this.limits.contextWindowTokens < 16 * 1024) {
      throw new Error('模型记忆长度无效。')
    }
    if (this.limits.compactionThresholdRatio <= 0 ||
      this.limits.compactionThresholdRatio >= 1) {
      throw new Error('会话整理阈值无效。')
    }
  }

  async prepare(
    messages: readonly AgentConversationMessage[],
    storedCheckpoint: AgentContextCheckpoint | null,
    options: { signal?: AbortSignal; onCompacting?: () => void } = {},
  ): Promise<PreparedAgentContext> {
    let checkpoint = storedCheckpoint
    let pending = this.messagesAfterCheckpoint(messages, checkpoint)
    const compactionThreshold = Math.floor(
      this.limits.contextWindowTokens * this.limits.compactionThresholdRatio,
    )
    const shouldCompact = this.limits.lastPromptTokens !== null &&
      this.limits.lastPromptTokens !== undefined &&
      this.limits.lastPromptTokens >= compactionThreshold
    const count = shouldCompact ? this.compactionCount(pending) : 0
    if (count > 0) {
      options.onCompacting?.()
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
    const preferredCount = Math.min(
      messages.length - this.limits.recentMessagesToKeep,
      this.limits.maxCompactionMessages,
    )
    let count = preferredCount > 0
      ? preferredCount
      : Math.min(messages.length - 2, this.limits.maxCompactionMessages)
    if (count <= 0) return 0
    while (count > 0 && messages[count - 1]?.role !== 'assistant') count -= 1
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
