import { create } from 'zustand'
import type { LlmMessage } from '@freecut/infrastructure/llm'
import {
  clearAiEditingConversation,
  loadAiEditingConversation,
  saveAiEditingConversation,
} from '@freecut/infrastructure/storage'
import { createLogger } from '@freecut/shared/logging/logger'
import {
  applyAiEditingPlan,
  getAiEditingAdapter,
  runAiEditingTurn,
} from './orchestrator'
import type { AiEditingObservation, AiEditingPlan } from './types'

const logger = createLogger('AiEditingStore')

export type AiEditingPhase = 'idle' | 'loading' | 'thinking' | 'awaiting-confirmation' | 'applying'

export interface AiEditingMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AiEditingState {
  supported: boolean
  phase: AiEditingPhase
  loadPercent: number
  error: string | null
  streamingText: string
  messages: AiEditingMessage[]
  observations: AiEditingObservation[]
  plan: AiEditingPlan | null
  projectId: string | null
  isRestoringConversation: boolean
  restoreConversation: (projectId: string | null) => Promise<void>
  submit: (text: string) => Promise<void>
  applyPlan: () => Promise<void>
  dismissPlan: () => void
  cancel: () => void
  clear: () => Promise<void>
}

let activeController: AbortController | null = null
let conversationLoadGeneration = 0
const conversationWrites = new Map<string, Promise<void>>()

function newId(): string {
  return crypto.randomUUID()
}

function buildHistory(messages: AiEditingMessage[]): LlmMessage[] {
  return messages.slice(-6).map((message) => ({ role: message.role, content: message.content }))
}

function observationsSummary(observations: readonly AiEditingObservation[]): string {
  const succeeded = observations.filter((item) => item.result.ok).length
  const failed = observations.length - succeeded
  if (failed === 0) return `已完成 ${succeeded} 项调整。`
  return `完成 ${succeeded} 项调整，${failed} 项未能完成。`
}

function enqueueConversationWrite(projectId: string, operation: () => Promise<void>): Promise<void> {
  const previous = conversationWrites.get(projectId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  conversationWrites.set(projectId, next)
  void next.then(
    () => {
      if (conversationWrites.get(projectId) === next) conversationWrites.delete(projectId)
    },
    () => {
      if (conversationWrites.get(projectId) === next) conversationWrites.delete(projectId)
    },
  )
  return next
}

export const useAiEditingStore = create<AiEditingState>((set, get) => ({
  supported: getAiEditingAdapter().isSupported(),
  phase: 'idle',
  loadPercent: 0,
  error: null,
  streamingText: '',
  messages: [],
  observations: [],
  plan: null,
  projectId: null,
  isRestoringConversation: false,

  restoreConversation: async (projectId) => {
    const generation = ++conversationLoadGeneration
    activeController?.abort()
    activeController = null
    set({
      projectId,
      isRestoringConversation: projectId !== null,
      phase: 'idle',
      loadPercent: 0,
      error: null,
      streamingText: '',
      messages: [],
      observations: [],
      plan: null,
    })
    if (!projectId) return

    await (conversationWrites.get(projectId) ?? Promise.resolve()).catch(() => undefined)
    const messages = await loadAiEditingConversation(projectId)
    if (generation !== conversationLoadGeneration || get().projectId !== projectId) return
    set({ messages, isRestoringConversation: false })
  },

  submit: async (text) => {
    const trimmed = text.trim()
    if (!trimmed || get().phase !== 'idle') return
    const projectId = get().projectId
    if (!projectId || get().isRestoringConversation) return

    const adapter = getAiEditingAdapter()
    if (!adapter.isSupported()) {
      set({ error: '当前设备暂不支持本地剪辑助手。', phase: 'idle' })
      return
    }

    const history = buildHistory(get().messages)
    const messages = [...get().messages, { id: newId(), role: 'user' as const, content: trimmed }]
    set({
      messages,
      phase: 'loading',
      error: null,
      streamingText: '',
      observations: [],
      plan: null,
    })
    try {
      await enqueueConversationWrite(projectId, () => saveAiEditingConversation(projectId, messages))
    } catch (error) {
      logger.warn('Failed to persist AI editing conversation', error)
      if (get().projectId === projectId) {
        set({ phase: 'idle', error: '无法保存本项目的对话记录。' })
      }
      return
    }
    if (get().projectId !== projectId) return

    try {
      await adapter.load((progress) => {
        if (get().projectId === projectId) set({ loadPercent: progress.percent })
      })
    } catch (error) {
      if (get().projectId === projectId) {
        set({
          phase: 'idle',
          error: error instanceof Error ? `无法准备剪辑助手：${error.message}` : '无法准备剪辑助手。',
        })
      }
      return
    }

    if (get().projectId !== projectId || get().isRestoringConversation) return

    const controller = new AbortController()
    activeController = controller
    set({ phase: 'thinking' })
    try {
      const result = await runAiEditingTurn(trimmed, {
        history,
        adapter,
        signal: controller.signal,
        onToken: (_delta, fullText) => {
          if (!controller.signal.aborted && get().projectId === projectId) {
            set({ streamingText: fullText })
          }
        },
      })
      if (controller.signal.aborted || get().projectId !== projectId) return
      const nextMessages = [
        ...get().messages,
        { id: newId(), role: 'assistant' as const, content: result.reply || '已完成分析。' },
      ]
      try {
        await enqueueConversationWrite(projectId, () => saveAiEditingConversation(projectId, nextMessages))
      } catch (error) {
        logger.warn('Failed to persist AI editing conversation', error)
        if (get().projectId === projectId) {
          set({ phase: 'idle', streamingText: '', error: '无法保存本项目的对话记录。' })
        }
        return
      }
      if (get().projectId !== projectId) return
      set({
        messages: nextMessages,
        observations: result.observations,
        plan: result.plan,
        streamingText: '',
        phase: result.plan ? 'awaiting-confirmation' : 'idle',
      })
    } catch (error) {
      if (!controller.signal.aborted && get().projectId === projectId) {
        set({
          phase: 'idle',
          streamingText: '',
          error: error instanceof Error ? error.message : '剪辑助手暂时无法完成这次请求。',
        })
      }
    } finally {
      if (activeController === controller) activeController = null
    }
  },

  applyPlan: async () => {
    const plan = get().plan
    if (!plan || get().phase !== 'awaiting-confirmation') return
    const projectId = get().projectId
    if (!projectId) return
    set({ phase: 'applying', error: null })
    try {
      const observations = await applyAiEditingPlan(plan)
      if (get().projectId !== projectId) return
      const messages = [
        ...get().messages,
        { id: newId(), role: 'assistant' as const, content: observationsSummary(observations) },
      ]
      try {
        await enqueueConversationWrite(projectId, () => saveAiEditingConversation(projectId, messages))
      } catch (error) {
        logger.warn('Failed to persist AI editing conversation', error)
        if (get().projectId === projectId) {
          set({ phase: 'awaiting-confirmation', error: '无法保存本项目的对话记录。' })
        }
        return
      }
      if (get().projectId !== projectId) return
      set({
        observations,
        plan: null,
        phase: 'idle',
        messages,
      })
    } catch (error) {
      if (get().projectId === projectId) {
        set({
          phase: 'awaiting-confirmation',
          error: error instanceof Error ? error.message : '无法应用这份剪辑计划。',
        })
      }
    }
  },

  dismissPlan: () => {
    if (get().phase === 'applying') return
    set({ plan: null, phase: 'idle' })
  },

  cancel: () => {
    activeController?.abort()
    activeController = null
    set({ phase: 'idle', streamingText: '' })
  },

  clear: async () => {
    activeController?.abort()
    activeController = null
    conversationLoadGeneration += 1
    const projectId = get().projectId
    set({
      messages: [],
      observations: [],
      plan: null,
      phase: 'idle',
      streamingText: '',
      error: null,
      isRestoringConversation: false,
    })
    if (!projectId) return
    try {
      await enqueueConversationWrite(projectId, () => clearAiEditingConversation(projectId))
    } catch (error) {
      logger.warn('Failed to clear AI editing conversation', error)
      if (get().projectId === projectId) set({ error: '无法清空本项目的对话记录。' })
    }
  },
}))
