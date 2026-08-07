import { create } from 'zustand'
import type { LlmMessage } from '@freecut/infrastructure/llm'
import {
  applyAiEditingPlan,
  getAiEditingAdapter,
  runAiEditingTurn,
} from './orchestrator'
import type { AiEditingObservation, AiEditingPlan } from './types'

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
  submit: (text: string) => Promise<void>
  applyPlan: () => Promise<void>
  dismissPlan: () => void
  cancel: () => void
  clear: () => void
}

let activeController: AbortController | null = null

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

export const useAiEditingStore = create<AiEditingState>((set, get) => ({
  supported: getAiEditingAdapter().isSupported(),
  phase: 'idle',
  loadPercent: 0,
  error: null,
  streamingText: '',
  messages: [],
  observations: [],
  plan: null,

  submit: async (text) => {
    const trimmed = text.trim()
    if (!trimmed || get().phase !== 'idle') return

    const adapter = getAiEditingAdapter()
    if (!adapter.isSupported()) {
      set({ error: '当前设备暂不支持本地剪辑助手。', phase: 'idle' })
      return
    }

    const history = buildHistory(get().messages)
    set((state) => ({
      messages: [...state.messages, { id: newId(), role: 'user', content: trimmed }],
      phase: 'loading',
      error: null,
      streamingText: '',
      observations: [],
      plan: null,
    }))

    try {
      await adapter.load((progress) => set({ loadPercent: progress.percent }))
    } catch (error) {
      set({
        phase: 'idle',
        error: error instanceof Error ? `无法准备剪辑助手：${error.message}` : '无法准备剪辑助手。',
      })
      return
    }

    const controller = new AbortController()
    activeController = controller
    set({ phase: 'thinking' })
    try {
      const result = await runAiEditingTurn(trimmed, {
        history,
        adapter,
        signal: controller.signal,
        onToken: (_delta, fullText) => set({ streamingText: fullText }),
      })
      set((state) => ({
        messages: [...state.messages, { id: newId(), role: 'assistant', content: result.reply || '已完成分析。' }],
        observations: result.observations,
        plan: result.plan,
        streamingText: '',
        phase: result.plan ? 'awaiting-confirmation' : 'idle',
      }))
    } catch (error) {
      if (!controller.signal.aborted) {
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
    set({ phase: 'applying', error: null })
    try {
      const observations = await applyAiEditingPlan(plan)
      set((state) => ({
        observations,
        plan: null,
        phase: 'idle',
        messages: [
          ...state.messages,
          { id: newId(), role: 'assistant', content: observationsSummary(observations) },
        ],
      }))
    } catch (error) {
      set({
        phase: 'awaiting-confirmation',
        error: error instanceof Error ? error.message : '无法应用这份剪辑计划。',
      })
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

  clear: () => {
    activeController?.abort()
    activeController = null
    set({ messages: [], observations: [], plan: null, phase: 'idle', streamingText: '', error: null })
  },
}))

