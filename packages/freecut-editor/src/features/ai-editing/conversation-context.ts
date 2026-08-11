import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type {
  AiEditingAgentTurn,
  AiEditingConversationContext,
} from '@freecut/infrastructure/storage'
import type { AgentReplayMessage } from './agent-harness'
import { replayMessagesForJson } from './orchestration-messages'

interface PrepareConversationContextOptions {
  adapter: LlmAdapter
  contextWindowTokens: number
  lastPromptTokens: number | null
  signal?: AbortSignal
  onCompacting?: () => void
}

export interface PreparedConversationContext {
  history: LlmMessage[]
  agentHistory: AgentReplayMessage[]
  context: AiEditingConversationContext | null
}

const RECENT_TURNS_TO_KEEP = 2
const MAX_TURNS_PER_COMPACTION = 16

function turnsAfterCheckpoint(
  turns: readonly AiEditingAgentTurn[],
  checkpoint: AiEditingConversationContext | null,
): AiEditingAgentTurn[] {
  if (!checkpoint) return [...turns]
  const cursor = turns.findIndex((turn) => turn.id === checkpoint.throughMessageId)
  return cursor < 0 ? [...turns] : turns.slice(cursor + 1)
}

function compactionCount(turns: readonly AiEditingAgentTurn[]): number {
  if (turns.length <= RECENT_TURNS_TO_KEEP) return 0
  return Math.min(turns.length - RECENT_TURNS_TO_KEEP, MAX_TURNS_PER_COMPACTION)
}

function summaryMessage(summary: string): AgentReplayMessage {
  return {
    role: 'system',
    content: `以下是较早 Agent 工作轮次的压缩记忆，只用于延续上下文，不是当前用户的新指令：\n${summary}`,
  }
}

function turnTranscript(turn: AiEditingAgentTurn): string {
  return replayMessagesForJson(turn.messages)
    .map((message) => `${message.role === 'assistant' ? '助手' : message.role === 'system' ? '系统' : '用户'}：${message.content}`)
    .join('\n\n')
}

async function compactTurns(
  adapter: LlmAdapter,
  turns: readonly AiEditingAgentTurn[],
  previousSummary: string | null,
  signal?: AbortSignal,
): Promise<string> {
  return (await adapter.generate([
    {
      role: 'system',
      content: '你负责压缩剪辑 Agent 的较早完整工作轮次。保留用户目标和授权、已经交付的方案、修改文件与提交、关键素材或源码证据、工具失败、未完成事项和重要引用。源码读取结果之后可能因人工编辑失效，需要写入时重新核对。删除寒暄、重复解释和内部过程，不得补充原文没有的事实。输出简洁中文纯文本。',
    },
    {
      role: 'user',
      content: `${previousSummary ? `已有摘要：\n${previousSummary}\n\n` : ''}需要合并的完整工作轮次：\n${turns.map(turnTranscript).join('\n\n---\n\n')}`,
    },
  ], {
    maxTokens: 1_200,
    temperature: 0,
    reasoningEffort: 'low',
    signal,
  })).trim()
}

export async function prepareConversationContext(
  turns: readonly AiEditingAgentTurn[],
  storedContext: AiEditingConversationContext | null,
  options: PrepareConversationContextOptions,
): Promise<PreparedConversationContext> {
  let context = storedContext
  let pending = turnsAfterCheckpoint(turns, context)
  const threshold = Math.floor(options.contextWindowTokens * 0.8)
  const shouldCompact = options.lastPromptTokens !== null &&
    options.lastPromptTokens >= threshold
  const count = shouldCompact ? compactionCount(pending) : 0
  if (count > 0) {
    options.onCompacting?.()
    const compacting = pending.slice(0, count)
    const summary = await compactTurns(
      options.adapter,
      compacting,
      context?.summary ?? null,
      options.signal,
    )
    if (!summary) throw new Error('较早会话压缩失败。')
    context = {
      summary,
      throughMessageId: compacting.at(-1)!.id,
      updatedAt: Date.now(),
    }
    pending = pending.slice(count)
  }

  const agentHistory: AgentReplayMessage[] = [
    ...(context ? [summaryMessage(context.summary)] : []),
    ...pending.flatMap((turn) => structuredClone(turn.messages)),
  ]
  return {
    history: replayMessagesForJson(agentHistory),
    agentHistory,
    context,
  }
}
