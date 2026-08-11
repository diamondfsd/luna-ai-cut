import { create } from 'zustand'
import {
  loadAiEditingConversationState,
  resumeAiEditingConversation,
  saveAiEditingConversationState,
} from '@freecut/infrastructure/storage'
import { createLogger } from '@freecut/shared/logging/logger'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { getAiEditingAdapter, runAiEditingTurn } from './run-ai-editing-turn'
import { addAiEditingReferenceContext } from './resource-references'
import { prepareConversationContext } from './conversation-context'
import { archiveAndClearAiEditingConversation } from './conversation-session-actions'
import {
  nextConversationWorkflow,
  resolveAiEditingTurnIntent,
} from './conversation-intent'
import {
  enqueueAiEditingConversationWrite,
  waitForAiEditingConversationWrites,
} from './conversation-writes'
import { newAiEditingMessageId } from './conversation-messages'
import { createAiEditingRunRecorder } from './run-recorder'
import {
  loadReasoningEffort,
  REASONING_EFFORT_STORAGE_KEY,
  REASONING_EFFORTS,
} from './reasoning-effort'
import type { AiEditingState } from './store-types'
import { createEmptyConversationState } from './store-state'

export type { AiEditingMessage } from './conversation-messages'
export type { AiEditingReasoningEffort } from './reasoning-effort'
const logger = createLogger('AiEditingStore')

let activeController: AbortController | null = null
let conversationLoadGeneration = 0

export const useAiEditingStore = create<AiEditingState>((set, get) => ({
  supported: getAiEditingAdapter().isSupported(),
  ...createEmptyConversationState(),
  reasoningEffort: loadReasoningEffort(),
  projectId: null,
  isRestoringConversation: false,
  isStartingNewConversation: false,

  restoreConversation: async (projectId) => {
    const generation = ++conversationLoadGeneration
    activeController?.abort()
    activeController = null
    set({
      ...createEmptyConversationState(),
      projectId,
      isRestoringConversation: projectId !== null,
      isStartingNewConversation: false,
    })
    if (!projectId) return

    await waitForAiEditingConversationWrites(projectId).catch(() => undefined)
    const conversation = await loadAiEditingConversationState(projectId)
    if (generation !== conversationLoadGeneration || get().projectId !== projectId) return
    set({
      messages: conversation.messages,
      agentTurns: conversation.agentTurns,
      loadedToolIds: conversation.loadedToolIds,
      agentContext: conversation.context,
      conversationWorkflow: conversation.workflow,
      lastPromptTokens: conversation.lastPromptTokens ?? null,
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
    const previousAgentTurns = get().agentTurns
    const storedLoadedToolIds = get().loadedToolIds
    const storedContext = get().agentContext
    const storedWorkflow = get().conversationWorkflow
    const storedPromptTokens = get().lastPromptTokens
    const turnIntent = resolveAiEditingTurnIntent(trimmed, previousMessages, storedWorkflow)
    const userMessageId = newAiEditingMessageId()
    const messages = [
      ...previousMessages,
      {
        id: userMessageId,
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
      reasoningText: '',
      draftAssistantText: '',
      observations: [],
      toolActivities: [],
      taskActivities: [],
    })
    try {
      await enqueueAiEditingConversationWrite(projectId, () =>
        saveAiEditingConversationState(projectId, {
          messages,
          agentTurns: previousAgentTurns,
          loadedToolIds: storedLoadedToolIds,
          context: storedContext,
          workflow: storedWorkflow,
          lastPromptTokens: storedPromptTokens,
        }),
      )
    } catch (error) {
      logger.warn('Failed to persist AI editing conversation', error)
      if (get().projectId === projectId) {
        set({ phase: 'idle', error: '无法保存本项目的对话记录。' })
      }
      return
    }
    if (get().projectId !== projectId) return

    const runRecorder = createAiEditingRunRecorder({
      id: userMessageId,
      projectId,
      request: trimmed,
    })
    let recorderSettled = false
    try {
      await runRecorder.start()
    } catch (error) {
      logger.warn('Failed to start AI editing run record', error)
    }

    const controller = new AbortController()
    activeController = controller
    runRecorder.trace({ type: 'model-loading', message: '正在准备剪辑模型。' })
    try {
      await adapter.load((progress) => {
        if (get().projectId === projectId) set({ loadPercent: progress.percent })
      })
    } catch (error) {
      try {
        await runRecorder.fail(error, 'model-loading')
        recorderSettled = true
      } catch (persistError) {
        logger.warn('Failed to persist model loading failure', persistError)
      }
      if (get().projectId === projectId) {
        set({
          phase: 'idle',
          error:
            error instanceof Error ? `无法准备剪辑助手：${error.message}` : '无法准备剪辑助手。',
        })
      }
      if (activeController === controller) activeController = null
      return
    }

    if (controller.signal.aborted || get().projectId !== projectId || get().isRestoringConversation) {
      try {
        await runRecorder.cancel()
        recorderSettled = true
      } catch (error) {
        logger.warn('Failed to persist cancelled AI editing run', error)
      }
      if (activeController === controller) activeController = null
      return
    }

    runRecorder.trace({ type: 'workspace-loading', message: '正在读取当前编辑空间。' })
    set({
      phase: 'thinking',
      thinkingLabel: '正在读取当前编辑空间',
      thinkingPercent: 3,
      thinkingCeiling: 6,
    })
    try {
      const contextWindowTokens = (await getEmbeddedHostBridge().aiAssistant?.getConfig())
        ?.contextWindowTokens ?? 256 * 1024
      const preparedContext = await prepareConversationContext(
        previousAgentTurns,
        storedContext,
        {
          adapter,
          contextWindowTokens,
          lastPromptTokens: storedPromptTokens,
          signal: controller.signal,
          onCompacting: () => {
            runRecorder.trace({ type: 'conversation-compacting', message: '正在压缩较早的会话。' })
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
            agentTurns: previousAgentTurns,
            loadedToolIds: storedLoadedToolIds,
            context: preparedContext.context,
            workflow: storedWorkflow,
            lastPromptTokens: null,
          }),
        )
        if (get().projectId !== projectId || controller.signal.aborted) return
        set({ agentContext: preparedContext.context, lastPromptTokens: null })
      }
      let runPromptTokens: number | null = null
      const result = await runAiEditingTurn(addAiEditingReferenceContext(trimmed, references), {
        history: preparedContext.history,
        agentHistory: preparedContext.agentHistory,
        loadedToolIds: storedLoadedToolIds,
        preferredProtocol: previousAgentTurns.at(-1)?.protocol,
        adapter,
        reasoningEffort: get().reasoningEffort,
        signal: controller.signal,
        onTraceEvent: (event) => runRecorder.trace(event),
        onModelUsage: (usage) => {
          if (controller.signal.aborted || get().projectId !== projectId) return
          runPromptTokens = Math.max(runPromptTokens ?? 0, usage.promptTokens)
          set({ lastPromptTokens: runPromptTokens })
          void enqueueAiEditingConversationWrite(projectId, () =>
            saveAiEditingConversationState(projectId, {
              messages: get().messages,
              agentTurns: get().agentTurns,
              loadedToolIds: get().loadedToolIds,
              context: preparedContext.context,
              workflow: storedWorkflow,
              lastPromptTokens: runPromptTokens,
            }),
          ).catch((error) => logger.warn('Failed to persist model token usage', error))
        },
        onFinalText: (content) => {
          if (!controller.signal.aborted && get().projectId === projectId) {
            set({ draftAssistantText: content, reasoningText: '' })
          }
        },
        onRunProgress: (progress) => {
          if (controller.signal.aborted || get().projectId !== projectId) return
          set({
            phase: 'thinking',
            thinkingLabel: progress.label,
            thinkingPercent: progress.percent,
            thinkingCeiling: progress.ceiling ?? progress.percent,
            ...(progress.reasoningText === undefined
              ? {}
              : { reasoningText: progress.reasoningText ?? '' }),
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
        turnIntent,
      })
      if (controller.signal.aborted || get().projectId !== projectId) return
      try {
        await runRecorder.complete(result)
        recorderSettled = true
      } catch (error) {
        logger.warn('Failed to persist AI editing run', error)
      }
      const assistantMessageId = newAiEditingMessageId()
      const assistantReply = result.reply || '已完成分析。'
      const nextMessages = [
        ...get().messages,
        {
          id: assistantMessageId,
          role: 'assistant' as const,
          content: assistantReply,
          createdAt: Date.now(),
        },
      ]
      const nextAgentTurns = [
        ...previousAgentTurns,
        { ...result.agentTurn, createdAt: Date.now() },
      ]
      const nextWorkflow = nextConversationWorkflow({
        previous: storedWorkflow,
        intent: turnIntent,
        userText: trimmed,
        assistantMessageId,
        assistantReply,
        completed: result.completed,
        changedTimeline: result.changedProject,
      })
      try {
        await enqueueAiEditingConversationWrite(projectId, () =>
          saveAiEditingConversationState(projectId, {
            messages: nextMessages,
            agentTurns: nextAgentTurns,
            loadedToolIds: result.loadedToolIds,
            context: preparedContext.context,
            workflow: nextWorkflow,
            lastPromptTokens: runPromptTokens ?? get().lastPromptTokens,
          }),
        )
      } catch (error) {
        logger.warn('Failed to persist AI editing conversation', error)
        if (get().projectId === projectId) {
          set({
            phase: 'idle',
            reasoningText: '',
            draftAssistantText: '',
            error: '无法保存本项目的对话记录。',
          })
        }
        return
      }
      if (get().projectId !== projectId) return
      set({
        messages: nextMessages,
        agentTurns: nextAgentTurns,
        loadedToolIds: result.loadedToolIds,
        conversationWorkflow: nextWorkflow,
        lastPromptTokens: runPromptTokens ?? get().lastPromptTokens,
        observations: result.observations,
        reasoningText: '',
        draftAssistantText: '',
        phase: 'idle',
      })
    } catch (error) {
      if (!controller.signal.aborted && get().projectId === projectId) {
        const message = error instanceof Error ? error.message : '剪辑助手暂时无法完成这次请求。'
        try {
          await runRecorder.fail(error, 'execution')
          recorderSettled = true
        } catch (persistError) {
          logger.warn('Failed to persist unsuccessful AI editing run', persistError)
        }
        set({
          phase: 'idle',
          reasoningText: '',
          draftAssistantText: '',
          error: message,
        })
      }
    } finally {
      if (!recorderSettled && controller.signal.aborted) {
        try {
          await runRecorder.cancel()
        } catch (error) {
          logger.warn('Failed to persist cancelled AI editing run', error)
        }
      }
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
      reasoningText: '',
      draftAssistantText: '',
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
      set(createEmptyConversationState())
      return
    }

    set({ isStartingNewConversation: true, error: null })
    try {
      const state = get()
      await enqueueAiEditingConversationWrite(projectId, () =>
        archiveAndClearAiEditingConversation(projectId, {
          messages,
          agentTurns: state.agentTurns,
          loadedToolIds: state.loadedToolIds,
          context: state.agentContext,
          workflow: state.conversationWorkflow,
          lastPromptTokens: state.lastPromptTokens,
        }),
      )
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
      ...createEmptyConversationState(),
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
      const conversation = await enqueueAiEditingConversationWrite(projectId, () =>
        resumeAiEditingConversation(projectId, sessionId),
      )
      if (get().projectId !== projectId) return false
      conversationLoadGeneration += 1
      set({
        ...createEmptyConversationState(),
        messages: conversation.messages,
        agentTurns: conversation.agentTurns,
        loadedToolIds: conversation.loadedToolIds,
        agentContext: conversation.context,
        conversationWorkflow: conversation.workflow,
        lastPromptTokens: conversation.lastPromptTokens ?? null,
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
