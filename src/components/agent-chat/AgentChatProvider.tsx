import { ChatContext } from './agentChatContext'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AgentChatContext } from '../../shared/types/agentChat'
import { AgentChatPanel } from './AgentChatPanel'

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pageContext, setPageContext] = useState<AgentChatContext>({})
  const updatePageContext = useCallback((next: AgentChatContext) => setPageContext(next), [])
  const [context, setContext] = useState<AgentChatContext>({})
  function show(next: AgentChatContext) { setContext(next); setOpen(true) }
  useEffect(() => window.luna.externalAgent.onOpenChat(show), [])
  return <ChatContext.Provider value={{ open: show, setPageContext: updatePageContext, toggle: () => { if (!open) setContext(pageContext); setOpen(value => !value) }, isOpen: open }}>
    {children}
    <AgentChatPanel open={open} context={context} onOpenChange={setOpen} />
  </ChatContext.Provider>
}
