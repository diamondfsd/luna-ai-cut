import { mergeAgentActivity } from './mergeAgentActivity'
import { useEffect, useState } from 'react'
import type { AiEditorAgentEvent, AiEditorAgentSnapshot } from '../../shared/types'

/** Subscribe before reading so in-flight reports cannot be lost or overwritten by a stale snapshot. */
export function useAgentActivity() {
  const [snapshot, setSnapshot] = useState<AiEditorAgentSnapshot>({ session: null, events: [] })
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const pending: AiEditorAgentEvent[] = []
    let ready = false
    const apply = (event: AiEditorAgentEvent) => setSnapshot(current => mergeAgentActivity(current, [event]))
    const unsubscribe = window.luna.aiEditor.agent.onEvent(event => {
      if (!active) return
      if (!ready) pending.push(event)
      else apply(event)
    })
    window.luna.aiEditor.agent.getSnapshot().then(value => {
      if (!active) return
      setSnapshot(mergeAgentActivity(value, pending))
      ready = true
    }).catch(() => {
      if (!active) return
      ready = true
      pending.forEach(apply)
      setError('无法读取任务记录')
    })
    return () => { active = false; unsubscribe() }
  }, [])
  return { snapshot, error }
}
