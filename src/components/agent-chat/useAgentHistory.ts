import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentConversation } from '../../shared/types/agentConversation'

export function useAgentHistory() {
  const [items, setItems] = useState<AgentConversation[]>([])
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const next = await window.luna.externalAgent.listConversations()
      if (current === generation.current) { setItems(next); setError('') }
    } catch { if (current === generation.current) setError('无法读取任务历史') }
  }, [])
  useEffect(() => {
    const requests = generation
    const unsubscribe = window.luna.externalAgent.onHistoryChanged(() => void refresh())
    void refresh()
    return () => { requests.current++; unsubscribe() }
  }, [refresh])
  return { items, error, refresh }
}
