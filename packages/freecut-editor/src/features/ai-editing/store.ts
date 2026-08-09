import { create } from 'zustand'
import type { LlmMessage } from '@freecut/infrastructure/llm'
import {
  clearAiEditingConversation,
  loadAiEditingConversation,
  saveAiEditingRun,
  saveAiEditingConversation,
} from '@freecut/infrastructure/storage'
import { createLogger } from '@freecut/shared/logging/logger'
import {
  getAiEditingAdapter,
  runAiEditingTurn,
} from './orchestrator'
import {
  addAiEditingReferenceContext,
  type AiEditingResourceReference,
} from './resource-references'
import type { AiEditingObservation, AiEditingToolActivity } from './types'

const logger = createLogger('AiEditingStore')

export type AiEditingPhase = 'idle' | 'loading' | 'thinking' | 'executing'
export type AiEditingReasoningEffort = 'low' | 'high' | 'xhigh' | 'max'

const REASONING_EFFORT_STORAGE_KEY = 'editor:aiEditingReasoningEffort'
const REASONING_EFFORTS = new Set<AiEditingReasoningEffort>(['low', 'high', 'xhigh', 'max'])

function loadReasoningEffort(): AiEditingReasoningEffort {
  if (typeof window === 'undefined') return 'high'
  try {
    const stored = window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY)
    return stored && REASONING_EFFORTS.has(stored as AiEditingReasoningEffort)
      ? stored as AiEditingReasoningEffort
      : 'high'
  } catch {
    return 'high'
  }
}

export interface AiEditingMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  references?: AiEditingResourceReference[]
}

interface AiEditingState {
  supported: boolean
  phase: AiEditingPhase
  loadPercent: number
  thinkingLabel: string
  thinkingPercent: number
  thinkingCeiling: number
  error: string | null
  streamingText: string
  messages: AiEditingMessage[]
  observations: AiEditingObservation[]
  toolActivities: AiEditingToolActivity[]
  reasoningEffort: AiEditingReasoningEffort
  projectId: string | null
  isRestoringConversation: boolean
  restoreConversation: (projectId: string | null) => Promise<void>
  submit: (text: string, references?: AiEditingResourceReference[]) => Promise<void>
  setReasoningEffort: (effort: AiEditingReasoningEffort) => void
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
  return messages.slice(-6).map((message) => ({
    role: message.role,
    content: message.role === 'user'
      ? addAiEditingReferenceContext(message.content, message.references ?? [])
      : message.content,
  }))
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
  thinkingLabel: '正在理解需求并规划剪辑',
  thinkingPercent: 0,
  thinkingCeiling: 0,
  error: null,
  streamingText: '',
  messages: [],
  observations: [],
  toolActivities: [],
  reasoningEffort: loadReasoningEffort(),
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
      thinkingLabel: '正在理解需求并规划剪辑',
      thinkingPercent: 0,
      thinkingCeiling: 0,
      error: null,
      streamingText: '',
      messages: [],
      observations: [],
      toolActivities: [],
    })
    if (!projectId) return

    await (conversationWrites.get(projectId) ?? Promise.resolve()).catch(() => undefined)
    const messages = await loadAiEditingConversation(projectId)
    if (generation !== conversationLoadGeneration || get().projectId !== projectId) return
    set({ messages, isRestoringConversation: false })
  },

  submit: async (text, references = []) => {
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
    const messages = [
      ...get().messages,
      {
        id: newId(),
        role: 'user' as const,
        content: trimmed,
        ...(references.length > 0 ? { references } : {}),
      },
    ]
    set({
      messages,
      phase: 'loading',
      loadPercent: 0,
      thinkingLabel: '正在理解需求并规划剪辑',
      thinkingPercent: 0,
      thinkingCeiling: 0,
      error: null,
      streamingText: '',
      observations: [],
      toolActivities: [],
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
    set({
      phase: 'thinking',
      thinkingLabel: '正在读取当前编辑空间',
      thinkingPercent: 3,
      thinkingCeiling: 6,
    })
    try {
      const result = await runAiEditingTurn(addAiEditingReferenceContext(trimmed, references), {
        history,
        adapter,
        reasoningEffort: get().reasoningEffort,
        signal: controller.signal,
        onToken: (_delta, fullText) => {
          if (!controller.signal.aborted && get().projectId === projectId) {
            set({ streamingText: fullText })
          }
        },
        onRunProgress: (progress) => {
          if (controller.signal.aborted || get().projectId !== projectId) return
          set({
            phase: 'thinking',
            thinkingLabel: progress.label,
            thinkingPercent: progress.percent,
            thinkingCeiling: progress.ceiling ?? progress.percent,
          })
        },
        onToolActivity: (activity) => {
          if (controller.signal.aborted || get().projectId !== projectId) return
          set((state) => {
            const existingIndex = state.toolActivities.findIndex((item) => item.id === activity.id)
            const toolActivities = existingIndex === -1
              ? [...state.toolActivities, activity]
              : state.toolActivities.map((item, index) => index === existingIndex ? activity : item)
            return {
              toolActivities,
              phase: activity.status === 'running' ? 'executing' : state.phase,
            }
          })
        },
      })
      if (controller.signal.aborted || get().projectId !== projectId) return
      try {
        await saveAiEditingRun(projectId, {
          id: newId(),
          createdAt: Date.now(),
          request: trimmed,
          ...(result.skillId ? { skillId: result.skillId } : {}),
          plan: result.plan,
          timelineRevisionBefore: result.timelineRevisionBefore,
          timelineRevisionAfter: result.timelineRevisionAfter,
          toolCalls: result.observations.map((observation) => ({
            id: observation.toolId,
            ok: observation.result.ok,
            message: observation.result.message,
          })),
          completed: result.completed,
          completionNotes: result.completionNotes,
          ...(result.production ? { production: result.production } : {}),
        })
      } catch (error) {
        logger.warn('Failed to persist AI editing run', error)
      }
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
        streamingText: '',
        phase: 'idle',
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

  setReasoningEffort: (effort) => {
    if (!REASONING_EFFORTS.has(effort)) return
    try {
      window.localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, effort)
    } catch {
      // Keep the preference for this editor session when storage is unavailable.
    }
    set({ reasoningEffort: effort })
  },

  cancel: () => {
    activeController?.abort()
    activeController = null
    set((state) => ({
      phase: 'idle',
      streamingText: '',
      thinkingPercent: 0,
      thinkingCeiling: 0,
      toolActivities: state.toolActivities.map((activity) => activity.status === 'running'
        ? { ...activity, status: 'failed', message: '已停止本次操作。' }
        : activity),
    }))
  },

  clear: async () => {
    activeController?.abort()
    activeController = null
    conversationLoadGeneration += 1
    const projectId = get().projectId
    set({
      messages: [],
      observations: [],
      toolActivities: [],
      phase: 'idle',
      streamingText: '',
      thinkingPercent: 0,
      thinkingCeiling: 0,
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
