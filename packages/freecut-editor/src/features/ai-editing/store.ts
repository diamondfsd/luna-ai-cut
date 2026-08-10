import { create } from 'zustand'
import {
  archiveAiEditingConversation,
  clearAiEditingConversation,
  loadAiEditingConversationState,
  resumeAiEditingConversation,
  saveAiEditingRun,
  saveAiEditingConversationState,
  type AiEditingConversationContext,
} from '@freecut/infrastructure/storage'
import { createLogger } from '@freecut/shared/logging/logger'
import { getAiEditingAdapter, runAiEditingTurn } from './run-ai-editing-turn'
import { getTimelineRevision } from './evidence'
import {
  addAiEditingReferenceContext,
  type AiEditingResourceReference,
} from './resource-references'
import type {
  AiEditingObservation,
  AiEditingTaskActivity,
  AiEditingToolActivity,
} from './types'
import { prepareConversationContext } from './conversation-context'
import {
  enqueueAiEditingConversationWrite,
  waitForAiEditingConversationWrites,
} from './conversation-writes'
import {
  conversationMessagesForModel,
  newAiEditingMessageId,
  type AiEditingMessage,
} from './conversation-messages'

export type { AiEditingMessage } from './conversation-messages'

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
      ? (stored as AiEditingReasoningEffort)
      : 'high'
  } catch {
    return 'high'
  }
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
  agentContext: AiEditingConversationContext | null
  observations: AiEditingObservation[]
  toolActivities: AiEditingToolActivity[]
  taskActivities: AiEditingTaskActivity[]
  reasoningEffort: AiEditingReasoningEffort
  projectId: string | null
  isRestoringConversation: boolean
  isStartingNewConversation: boolean
  restoreConversation: (projectId: string | null) => Promise<void>
  submit: (text: string, references?: AiEditingResourceReference[]) => Promise<void>
  setReasoningEffort: (effort: AiEditingReasoningEffort) => void
  cancel: () => void
  startNewConversation: () => Promise<void>
  resumeConversation: (sessionId: string) => Promise<boolean>
}

let activeController: AbortController | null = null
let conversationLoadGeneration = 0

export const useAiEditingStore = create<AiEditingState>((set, get) => ({
  supported: getAiEditingAdapter().isSupported(),
  phase: 'idle',
  loadPercent: 0,
  thinkingLabel: '正在理解需求',
  thinkingPercent: 0,
  thinkingCeiling: 0,
  error: null,
  streamingText: '',
  messages: [],
  agentContext: null,
  observations: [],
  toolActivities: [],
  taskActivities: [],
  reasoningEffort: loadReasoningEffort(),
  projectId: null,
  isRestoringConversation: false,
  isStartingNewConversation: false,

  restoreConversation: async (projectId) => {
    const generation = ++conversationLoadGeneration
    activeController?.abort()
    activeController = null
    set({
      projectId,
      isRestoringConversation: projectId !== null,
      isStartingNewConversation: false,
      phase: 'idle',
      loadPercent: 0,
      thinkingLabel: '正在理解需求',
      thinkingPercent: 0,
      thinkingCeiling: 0,
      error: null,
      streamingText: '',
      messages: [],
      agentContext: null,
      observations: [],
      toolActivities: [],
      taskActivities: [],
    })
    if (!projectId) return

    await waitForAiEditingConversationWrites(projectId).catch(() => undefined)
    const conversation = await loadAiEditingConversationState(projectId)
    if (generation !== conversationLoadGeneration || get().projectId !== projectId) return
    set({
      messages: conversation.messages,
      agentContext: conversation.context,
      isRestoringConversation: false,
    })
  },

  submit: async (text, references = []) => {
    const trimmed = text.trim()
    if (!trimmed || get().phase !== 'idle' || get().isStartingNewConversation) return
    const projectId = get().projectId
    if (!projectId || get().isRestoringConversation) return

    const adapter = getAiEditingAdapter()
    if (!adapter.isSupported()) {
      set({ error: '当前设备暂不支持本地剪辑助手。', phase: 'idle' })
      return
    }

    const previousMessages = get().messages
    const storedContext = get().agentContext
    const messages = [
      ...previousMessages,
      {
        id: newAiEditingMessageId(),
        role: 'user' as const,
        content: trimmed,
        createdAt: Date.now(),
        ...(references.length > 0 ? { references } : {}),
      },
    ]
    set({
      messages,
      phase: 'loading',
      loadPercent: 0,
      thinkingLabel: '正在理解需求',
      thinkingPercent: 0,
      thinkingCeiling: 0,
      error: null,
      streamingText: '',
      observations: [],
      toolActivities: [],
      taskActivities: [],
    })
    try {
      await enqueueAiEditingConversationWrite(projectId, () =>
        saveAiEditingConversationState(projectId, { messages, context: storedContext }),
      )
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
          error:
            error instanceof Error ? `无法准备剪辑助手：${error.message}` : '无法准备剪辑助手。',
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
    const timelineRevisionBefore = getTimelineRevision()
    try {
      const preparedContext = await prepareConversationContext(
        conversationMessagesForModel(previousMessages),
        storedContext,
        {
          adapter,
          signal: controller.signal,
          onCompacting: () => {
            if (get().projectId === projectId) {
              set({ thinkingLabel: '正在整理较早的会话', thinkingPercent: 5, thinkingCeiling: 10 })
            }
          },
        },
      )
      if (preparedContext.context !== storedContext) {
        await enqueueAiEditingConversationWrite(projectId, () =>
          saveAiEditingConversationState(projectId, {
            messages,
            context: preparedContext.context,
          }),
        )
        if (get().projectId !== projectId || controller.signal.aborted) return
        set({ agentContext: preparedContext.context })
      }
      const result = await runAiEditingTurn(addAiEditingReferenceContext(trimmed, references), {
        history: preparedContext.history,
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
            ...(progress.previewText === undefined
              ? {}
              : { streamingText: progress.previewText }),
          })
        },
        onToolActivity: (activity) => {
          if (controller.signal.aborted || get().projectId !== projectId) return
          set((state) => {
            const existingIndex = state.toolActivities.findIndex((item) => item.id === activity.id)
            const toolActivities =
              existingIndex === -1
                ? [...state.toolActivities, activity]
                : state.toolActivities.map((item, index) =>
                    index === existingIndex ? activity : item,
                  )
            return {
              toolActivities,
              phase: activity.status === 'running' ? 'executing' : state.phase,
            }
          })
        },
        onTaskActivity: (activity) => {
          if (controller.signal.aborted || get().projectId !== projectId) return
          set((state) => {
            const existingIndex = state.taskActivities.findIndex((item) => item.id === activity.id)
            return {
              taskActivities: existingIndex === -1
                ? [...state.taskActivities, activity]
                : state.taskActivities.map((item, index) => index === existingIndex ? activity : item),
            }
          })
        },
      })
      if (controller.signal.aborted || get().projectId !== projectId) return
      try {
        await saveAiEditingRun(projectId, {
          id: newAiEditingMessageId(),
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
            ...(observation.result.data &&
              typeof observation.result.data === 'object' &&
              Array.isArray((observation.result.data as { validationIssues?: unknown }).validationIssues)
              ? {
                  details: (observation.result.data as { validationIssues: unknown[] }).validationIssues
                    .filter((entry): entry is string => typeof entry === 'string')
                    .slice(0, 8),
                }
              : {}),
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
        {
          id: newAiEditingMessageId(),
          role: 'assistant' as const,
          content: result.reply || '已完成分析。',
          createdAt: Date.now(),
        },
      ]
      try {
        await enqueueAiEditingConversationWrite(projectId, () =>
          saveAiEditingConversationState(projectId, {
            messages: nextMessages,
            context: preparedContext.context,
          }),
        )
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
        const message = error instanceof Error ? error.message : '剪辑助手暂时无法完成这次请求。'
        try {
          await saveAiEditingRun(projectId, {
            id: newAiEditingMessageId(),
            createdAt: Date.now(),
            request: trimmed,
            plan: [],
            timelineRevisionBefore,
            timelineRevisionAfter: getTimelineRevision(),
            toolCalls: [],
            completed: false,
            completionNotes: [message],
          })
        } catch (persistError) {
          logger.warn('Failed to persist unsuccessful AI editing run', persistError)
        }
        set({
          phase: 'idle',
          streamingText: '',
          error: message,
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
      toolActivities: state.toolActivities.map((activity) =>
        activity.status === 'running'
          ? { ...activity, status: 'failed', message: '已停止本次操作。' }
          : activity,
      ),
      taskActivities: state.taskActivities.map((activity) =>
        activity.status === 'running'
          ? { ...activity, status: 'failed', message: '已停止本次操作。' }
          : activity,
      ),
    }))
  },

  startNewConversation: async () => {
    if (get().phase !== 'idle' || get().isStartingNewConversation) return
    activeController?.abort()
    activeController = null
    const projectId = get().projectId
    const messages = get().messages
    if (!projectId) {
      set({
        messages: [],
        agentContext: null,
        observations: [],
        toolActivities: [],
        taskActivities: [],
        streamingText: '',
        thinkingPercent: 0,
        thinkingCeiling: 0,
        error: null,
      })
      return
    }

    set({ isStartingNewConversation: true, error: null })
    try {
      await enqueueAiEditingConversationWrite(projectId, async () => {
        if (messages.length > 0) {
          await archiveAiEditingConversation(projectId, {
            id: messages[0]?.id ?? newAiEditingMessageId(),
            createdAt: messages[0]?.createdAt ?? Date.now(),
            archivedAt: Date.now(),
            messages,
          })
        }
        await clearAiEditingConversation(projectId)
      })
    } catch (error) {
      logger.warn('Failed to archive AI editing conversation', error)
      if (get().projectId === projectId) {
        set({ isStartingNewConversation: false, error: '无法保存当前对话，未新建会话。' })
      }
      return
    }
    if (get().projectId !== projectId) return
    conversationLoadGeneration += 1
    set({
      messages: [],
      agentContext: null,
      observations: [],
      toolActivities: [],
      taskActivities: [],
      phase: 'idle',
      streamingText: '',
      thinkingPercent: 0,
      thinkingCeiling: 0,
      error: null,
      isRestoringConversation: false,
      isStartingNewConversation: false,
    })
  },

  resumeConversation: async (sessionId) => {
    if (
      get().phase !== 'idle' ||
      get().isStartingNewConversation ||
      get().isRestoringConversation
    ) {
      return false
    }
    const projectId = get().projectId
    if (!projectId) return false

    activeController?.abort()
    activeController = null
    set({ isRestoringConversation: true, error: null })
    try {
      const messages = await enqueueAiEditingConversationWrite(projectId, () =>
        resumeAiEditingConversation(projectId, sessionId),
      )
      if (get().projectId !== projectId) return false
      conversationLoadGeneration += 1
      set({
        messages,
        agentContext: null,
        observations: [],
        toolActivities: [],
        taskActivities: [],
        phase: 'idle',
        streamingText: '',
        thinkingPercent: 0,
        thinkingCeiling: 0,
        error: null,
        isRestoringConversation: false,
      })
      return true
    } catch (error) {
      logger.warn('Failed to resume AI editing conversation', error)
      if (get().projectId === projectId) {
        set({ isRestoringConversation: false, error: '无法恢复这段历史会话，当前会话没有改变。' })
      }
      return false
    }
  },
}))
