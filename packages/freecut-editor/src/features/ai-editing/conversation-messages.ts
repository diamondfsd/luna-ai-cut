import type { AiEditingResourceReference } from './resource-references'

export interface AiEditingMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  references?: AiEditingResourceReference[]
}

export function newAiEditingMessageId(): string {
  return crypto.randomUUID()
}
