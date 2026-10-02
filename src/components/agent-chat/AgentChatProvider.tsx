import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AgentChatContext } from '../../shared/types/agentChat'
import { AgentChatDialog } from './AgentChatDialog'

const ChatContext = createContext<{ open(context: AgentChatContext): void } | null>(null)

export function useAgentChat() {
  const value = useContext(ChatContext)
  if (!value) throw new Error('AI 助手未准备好')
  return value
}

export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<AgentChatContext>({ purpose: 'editing' })
  function show(next: AgentChatContext) { setContext(next); setOpen(true) }
  useEffect(() => window.luna.externalAgent.onOpenChat(show), [])
  return <ChatContext.Provider value={{ open: show }}>
    {children}
    <AgentChatDialog open={open} context={context} onOpenChange={setOpen} />
  </ChatContext.Provider>
}
