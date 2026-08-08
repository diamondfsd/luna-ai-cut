/**
 * Project-scoped AI editing conversation history.
 *
 * Conversation text is kept beside the project rather than in browser storage
 * so reopening a project restores its own context and a different project
 * never inherits it.
 */

import { createLogger } from '@freecut/shared/logging/logger'

import { readJson, removeEntry, writeJsonAtomic } from './fs-primitives'
import { projectAiEditingConversationPath } from './paths'
import { requireWorkspaceRoot } from './root'

const logger = createLogger('WorkspaceFS:AiEditingConversation')
const CONVERSATION_VERSION = 1

export interface AiEditingConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AiEditingConversationFile {
  version: typeof CONVERSATION_VERSION
  messages: AiEditingConversationMessage[]
}

function sanitizeMessage(value: unknown): AiEditingConversationMessage | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingConversationMessage>
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    (candidate.role !== 'user' && candidate.role !== 'assistant') ||
    typeof candidate.content !== 'string'
  ) {
    return null
  }
  return { id: candidate.id, role: candidate.role, content: candidate.content }
}

function sanitizeConversation(value: unknown): AiEditingConversationMessage[] {
  if (!value || typeof value !== 'object') return []
  const candidate = value as Partial<AiEditingConversationFile>
  if (candidate.version !== CONVERSATION_VERSION || !Array.isArray(candidate.messages)) return []
  return candidate.messages
    .map(sanitizeMessage)
    .filter((message): message is AiEditingConversationMessage => message !== null)
}

export async function loadAiEditingConversation(projectId: string): Promise<AiEditingConversationMessage[]> {
  try {
    const file = await readJson<unknown>(requireWorkspaceRoot(), projectAiEditingConversationPath(projectId))
    return sanitizeConversation(file)
  } catch (error) {
    logger.warn(`loadAiEditingConversation(${projectId}) failed`, error)
    return []
  }
}

export async function saveAiEditingConversation(
  projectId: string,
  messages: AiEditingConversationMessage[],
): Promise<void> {
  try {
    const file: AiEditingConversationFile = {
      version: CONVERSATION_VERSION,
      messages: messages.map((message) => ({ ...message })),
    }
    await writeJsonAtomic(requireWorkspaceRoot(), projectAiEditingConversationPath(projectId), file)
  } catch (error) {
    logger.error(`saveAiEditingConversation(${projectId}) failed`, error)
    throw new Error('Failed to save AI editing conversation')
  }
}

export async function clearAiEditingConversation(projectId: string): Promise<void> {
  try {
    await removeEntry(requireWorkspaceRoot(), projectAiEditingConversationPath(projectId))
  } catch (error) {
    logger.error(`clearAiEditingConversation(${projectId}) failed`, error)
    throw new Error('Failed to clear AI editing conversation')
  }
}
