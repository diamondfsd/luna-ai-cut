import {
  addAiEditingReferenceContext,
  type AiEditingResourceReference,
} from './resource-references'

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

export function conversationMessagesForModel(messages: readonly AiEditingMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.role === 'user'
      ? addAiEditingReferenceContext(message.content, message.references ?? [])
      : message.content,
  }))
}
