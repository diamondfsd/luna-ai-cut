import { ChatContext } from './agentChatContext'
import { useEffect, useState, type ReactNode } from 'react'
import type { AgentChatContext } from '../../shared/types/agentChat'
import { AgentChatPanel } from './AgentChatPanel'

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<AgentChatContext>({ purpose: 'editing' })
  function show(next: AgentChatContext) { setContext(next); setOpen(true) }
  useEffect(() => window.luna.externalAgent.onOpenChat(show), [])
  return <ChatContext.Provider value={{ open: show, toggle: () => setOpen(value => !value), isOpen: open }}>
    {children}
    <AgentChatPanel open={open} context={context} onOpenChange={setOpen} />
  </ChatContext.Provider>
}
