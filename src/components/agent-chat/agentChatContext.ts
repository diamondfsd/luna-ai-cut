import { createContext, useContext } from 'react'
import type { AgentChatContext } from '../../shared/types/agentChat'

export const ChatContext = createContext<{ open(context: AgentChatContext): void; toggle(): void; isOpen: boolean } | null>(null)
export function useAgentChat() {
  const value = useContext(ChatContext)
  if (!value) throw new Error('AI 助手未准备好')
  return value
}
