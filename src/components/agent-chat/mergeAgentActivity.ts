import type { AiEditorAgentEvent, AiEditorAgentSnapshot } from '../../shared/types'

export function mergeAgentActivity(snapshot: AiEditorAgentSnapshot, incoming: AiEditorAgentEvent[]): AiEditorAgentSnapshot {
  const events = [...new Map([...snapshot.events, ...incoming].map(event => [event.sequence, event])).values()]
    .sort((a, b) => a.sequence - b.sequence).slice(-200)
  return { session: events[events.length - 1]?.session ?? snapshot.session, events }
}
