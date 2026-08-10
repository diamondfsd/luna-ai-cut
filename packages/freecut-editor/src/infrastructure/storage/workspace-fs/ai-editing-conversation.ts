/**
 * Project-scoped AI editing conversation history.
 *
 * Conversation text is kept beside the project rather than in browser storage
 * so reopening a project restores its own context and a different project
 * never inherits it.
 */

import { createLogger } from '@freecut/shared/logging/logger'

import { readJson, removeEntry, writeJsonAtomic } from './fs-primitives'
import {
  projectAiEditingConversationHistoryPath,
  projectAiEditingConversationPath,
} from './paths'
import { requireWorkspaceRoot } from './root'

const logger = createLogger('WorkspaceFS:AiEditingConversation')
const CONVERSATION_VERSION = 2
const CONVERSATION_HISTORY_VERSION = 1

export interface AiEditingConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  references?: AiEditingConversationReference[]
}

export interface AiEditingConversationReference {
  kind: 'project' | 'media' | 'timeline-clip'
  id: string
  label: string
}

interface AiEditingConversationFile {
  version: typeof CONVERSATION_VERSION
  messages: AiEditingConversationMessage[]
}

export interface AiEditingConversationHistorySession {
  id: string
  createdAt: number
  archivedAt: number
  messages: AiEditingConversationMessage[]
}

interface AiEditingConversationHistoryFile {
  version: typeof CONVERSATION_HISTORY_VERSION
  sessions: AiEditingConversationHistorySession[]
}

function sanitizeMessage(value: unknown): AiEditingConversationMessage | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingConversationMessage>
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    (candidate.role !== 'user' && candidate.role !== 'assistant') ||
    typeof candidate.content !== 'string' ||
    typeof candidate.createdAt !== 'number' ||
    !Number.isFinite(candidate.createdAt) ||
    candidate.createdAt < 0
  ) {
    return null
  }
  const references = sanitizeReferences(candidate.references)
  return {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    createdAt: candidate.createdAt,
    ...(references.length > 0 ? { references } : {}),
  }
}

function sanitizeReferences(value: unknown): AiEditingConversationReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<AiEditingConversationReference>
    if (
      (candidate.kind !== 'project' &&
        candidate.kind !== 'media' &&
        candidate.kind !== 'timeline-clip') ||
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      typeof candidate.label !== 'string' ||
      !candidate.label
    ) {
      return []
    }
    return [{ kind: candidate.kind, id: candidate.id, label: candidate.label }]
  })
}

function sanitizeConversation(value: unknown): AiEditingConversationMessage[] {
  if (!value || typeof value !== 'object') return []
  const candidate = value as Partial<AiEditingConversationFile>
  if (candidate.version !== CONVERSATION_VERSION || !Array.isArray(candidate.messages)) return []
  return candidate.messages
    .map(sanitizeMessage)
    .filter((message): message is AiEditingConversationMessage => message !== null)
}

function sanitizeHistorySession(value: unknown): AiEditingConversationHistorySession | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingConversationHistorySession>
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.createdAt !== 'number' ||
    !Number.isFinite(candidate.createdAt) ||
    candidate.createdAt < 0 ||
    typeof candidate.archivedAt !== 'number' ||
    !Number.isFinite(candidate.archivedAt) ||
    candidate.archivedAt < 0 ||
    !Array.isArray(candidate.messages)
  ) {
    return null
  }
  const messages = candidate.messages
    .map(sanitizeMessage)
    .filter((message): message is AiEditingConversationMessage => message !== null)
  if (messages.length === 0) return null
  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    archivedAt: candidate.archivedAt,
    messages,
  }
}

function sanitizeConversationHistory(value: unknown): AiEditingConversationHistorySession[] {
  if (!value || typeof value !== 'object') return []
  const candidate = value as Partial<AiEditingConversationHistoryFile>
  if (candidate.version !== CONVERSATION_HISTORY_VERSION || !Array.isArray(candidate.sessions)) {
    return []
  }
  return candidate.sessions
    .map(sanitizeHistorySession)
    .filter((session): session is AiEditingConversationHistorySession => session !== null)
    .sort((left, right) => right.archivedAt - left.archivedAt)
}

export async function loadAiEditingConversation(
  projectId: string,
): Promise<AiEditingConversationMessage[]> {
  try {
    const file = await readJson<unknown>(
      requireWorkspaceRoot(),
      projectAiEditingConversationPath(projectId),
    )
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

export async function listAiEditingConversationHistory(
  projectId: string,
): Promise<AiEditingConversationHistorySession[]> {
  try {
    const file = await readJson<unknown>(
      requireWorkspaceRoot(),
      projectAiEditingConversationHistoryPath(projectId),
    )
    return sanitizeConversationHistory(file)
  } catch (error) {
    logger.warn(`listAiEditingConversationHistory(${projectId}) failed`, error)
    return []
  }
}

export async function archiveAiEditingConversation(
  projectId: string,
  session: AiEditingConversationHistorySession,
): Promise<void> {
  const sanitizedSession = sanitizeHistorySession(session)
  if (!sanitizedSession) {
    throw new Error('Cannot archive an invalid AI editing conversation')
  }
  try {
    const existing = await listAiEditingConversationHistory(projectId)
    const file: AiEditingConversationHistoryFile = {
      version: CONVERSATION_HISTORY_VERSION,
      sessions: [sanitizedSession, ...existing.filter((entry) => entry.id !== sanitizedSession.id)],
    }
    await writeJsonAtomic(
      requireWorkspaceRoot(),
      projectAiEditingConversationHistoryPath(projectId),
      file,
    )
  } catch (error) {
    logger.error(`archiveAiEditingConversation(${projectId}) failed`, error)
    throw new Error('Failed to archive AI editing conversation')
  }
}
