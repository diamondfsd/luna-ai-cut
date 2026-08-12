/**
 * Project-scoped AI editing conversation history.
 *
 * Conversation text is kept beside the project rather than in browser storage
 * so reopening a project restores its own context and a different project
 * never inherits it.
 */

import { createLogger } from '@freecut/shared/logging/logger'

import { readJson, removeEntry, writeJsonAtomic } from './fs-primitives'
import { projectAiEditingConversationHistoryPath, projectAiEditingConversationPath } from './paths'
import { requireWorkspaceRoot } from './root'
import {
  sanitizeAgentTurn,
  sanitizeLoadedToolIds,
  type AiEditingAgentTurn,
} from './ai-editing-agent-conversation'
export type {
  AiEditingAgentMessage,
  AiEditingAgentToolCall,
  AiEditingAgentTurn,
} from './ai-editing-agent-conversation'

const logger = createLogger('WorkspaceFS:AiEditingConversation')
const CONVERSATION_VERSION = 3
const CONVERSATION_HISTORY_VERSION = 2

export interface AiEditingConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  references?: AiEditingConversationReference[]
}

export interface AiEditingConversationContext {
  summary: string
  throughMessageId: string
  updatedAt: number
}

export interface AiEditingConversationState {
  messages: AiEditingConversationMessage[]
  agentTurns: AiEditingAgentTurn[]
  loadedToolIds: string[]
  context: AiEditingConversationContext | null
  lastPromptTokens?: number | null
}

export interface AiEditingConversationReference {
  kind: 'project' | 'media' | 'timeline-clip'
  id: string
  label: string
}

interface AiEditingConversationFile {
  version: typeof CONVERSATION_VERSION
  messages: AiEditingConversationMessage[]
  agentTurns: AiEditingAgentTurn[]
  loadedToolIds: string[]
  context?: AiEditingConversationContext
  lastPromptTokens?: number
}

export interface AiEditingConversationHistorySession {
  id: string
  createdAt: number
  archivedAt: number
  messages: AiEditingConversationMessage[]
  agentTurns: AiEditingAgentTurn[]
  loadedToolIds: string[]
  context: AiEditingConversationContext | null
  lastPromptTokens?: number | null
}

interface AiEditingConversationHistoryFile {
  version: typeof CONVERSATION_HISTORY_VERSION
  sessions: AiEditingConversationHistorySession[]
}

async function writeConversationHistory(
  projectId: string,
  sessions: AiEditingConversationHistorySession[],
): Promise<void> {
  const file: AiEditingConversationHistoryFile = {
    version: CONVERSATION_HISTORY_VERSION,
    sessions,
  }
  await writeJsonAtomic(
    requireWorkspaceRoot(),
    projectAiEditingConversationHistoryPath(projectId),
    file,
  )
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

function sanitizeContext(value: unknown): AiEditingConversationContext | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingConversationContext>
  if (
    typeof candidate.summary !== 'string' || !candidate.summary.trim() ||
    typeof candidate.throughMessageId !== 'string' || !candidate.throughMessageId ||
    typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)
  ) return null
  return {
    summary: candidate.summary.trim(),
    throughMessageId: candidate.throughMessageId,
    updatedAt: candidate.updatedAt,
  }
}

function sanitizeConversation(value: unknown): AiEditingConversationState {
  if (!value || typeof value !== 'object') {
    return { messages: [], agentTurns: [], loadedToolIds: [], context: null }
  }
  const candidate = value as Partial<AiEditingConversationFile>
  if (candidate.version !== CONVERSATION_VERSION || !Array.isArray(candidate.messages)) {
    return { messages: [], agentTurns: [], loadedToolIds: [], context: null }
  }
  const messages = candidate.messages
    .map(sanitizeMessage)
    .filter((message): message is AiEditingConversationMessage => message !== null)
  const agentTurns = Array.isArray(candidate.agentTurns)
    ? candidate.agentTurns
      .map(sanitizeAgentTurn)
      .filter((turn): turn is AiEditingAgentTurn => turn !== null)
    : []
  const loadedToolIds = sanitizeLoadedToolIds(candidate.loadedToolIds)
  const context = sanitizeContext(candidate.context)
  const lastPromptTokens = typeof candidate.lastPromptTokens === 'number' &&
    Number.isSafeInteger(candidate.lastPromptTokens) && candidate.lastPromptTokens >= 0
    ? candidate.lastPromptTokens
    : null
  return {
    messages,
    agentTurns,
    loadedToolIds,
    context: context && agentTurns.some((turn) => turn.id === context.throughMessageId)
      ? context
      : null,
    ...(lastPromptTokens === null ? {} : { lastPromptTokens }),
  }
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
    !Array.isArray(candidate.messages) ||
    !Array.isArray(candidate.agentTurns) ||
    !Array.isArray(candidate.loadedToolIds)
  ) {
    return null
  }
  const messages = candidate.messages
    .map(sanitizeMessage)
    .filter((message): message is AiEditingConversationMessage => message !== null)
  if (messages.length === 0) return null
  const agentTurns = candidate.agentTurns
    .map(sanitizeAgentTurn)
    .filter((turn): turn is AiEditingAgentTurn => turn !== null)
  const context = sanitizeContext(candidate.context)
  const lastPromptTokens = typeof candidate.lastPromptTokens === 'number' &&
    Number.isSafeInteger(candidate.lastPromptTokens) && candidate.lastPromptTokens >= 0
    ? candidate.lastPromptTokens
    : null
  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    archivedAt: candidate.archivedAt,
    messages,
    agentTurns,
    loadedToolIds: sanitizeLoadedToolIds(candidate.loadedToolIds),
    context: context && agentTurns.some((turn) => turn.id === context.throughMessageId)
      ? context
      : null,
    ...(lastPromptTokens === null ? {} : { lastPromptTokens }),
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
  return (await loadAiEditingConversationState(projectId)).messages
}

export async function loadAiEditingConversationState(
  projectId: string,
): Promise<AiEditingConversationState> {
  try {
    const file = await readJson<unknown>(
      requireWorkspaceRoot(),
      projectAiEditingConversationPath(projectId),
    )
    return sanitizeConversation(file)
  } catch (error) {
    logger.warn(`loadAiEditingConversation(${projectId}) failed`, error)
    return { messages: [], agentTurns: [], loadedToolIds: [], context: null }
  }
}

export async function saveAiEditingConversation(
  projectId: string,
  messages: AiEditingConversationMessage[],
): Promise<void> {
  await saveAiEditingConversationState(projectId, {
    messages,
    agentTurns: [],
    loadedToolIds: [],
    context: null,
    lastPromptTokens: null,
  })
}

export async function saveAiEditingConversationState(
  projectId: string,
  state: AiEditingConversationState,
): Promise<void> {
  try {
    const file: AiEditingConversationFile = {
      version: CONVERSATION_VERSION,
      messages: state.messages.map((message) => ({ ...message })),
      agentTurns: structuredClone(state.agentTurns),
      loadedToolIds: [...state.loadedToolIds],
      ...(state.context ? { context: { ...state.context } } : {}),
      ...(typeof state.lastPromptTokens === 'number'
        ? { lastPromptTokens: state.lastPromptTokens }
        : {}),
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
    await writeConversationHistory(projectId, [
      sanitizedSession,
      ...existing.filter((entry) => entry.id !== sanitizedSession.id),
    ])
  } catch (error) {
    logger.error(`archiveAiEditingConversation(${projectId}) failed`, error)
    throw new Error('Failed to archive AI editing conversation')
  }
}

export async function resumeAiEditingConversation(
  projectId: string,
  sessionId: string,
): Promise<AiEditingConversationState> {
  try {
    const history = await listAiEditingConversationHistory(projectId)
    const target = history.find((session) => session.id === sessionId)
    if (!target) throw new Error('Conversation session not found')

    const current = await loadAiEditingConversationState(projectId)
    const currentMessages = current.messages
    const currentSession: AiEditingConversationHistorySession | null =
      currentMessages.length > 0
        ? {
            id: currentMessages[0]?.id ?? crypto.randomUUID(),
            createdAt: currentMessages[0]?.createdAt ?? Date.now(),
            archivedAt: Date.now(),
            messages: currentMessages,
            agentTurns: current.agentTurns,
            loadedToolIds: current.loadedToolIds,
            context: current.context,
            lastPromptTokens: current.lastPromptTokens,
          }
        : null
    const historyWithCurrent = [
      ...(currentSession ? [currentSession] : []),
      ...history.filter((session) => session.id !== currentSession?.id),
    ]

    // Preserve both conversations before replacing the current file. If the
    // final cleanup fails, the resumed session is duplicated but not lost.
    if (currentSession) await writeConversationHistory(projectId, historyWithCurrent)
    await saveAiEditingConversationState(projectId, {
      messages: target.messages,
      agentTurns: target.agentTurns,
      loadedToolIds: target.loadedToolIds,
      context: target.context,
      lastPromptTokens: target.lastPromptTokens,
    })
    try {
      await writeConversationHistory(
        projectId,
        historyWithCurrent.filter((session) => session.id !== target.id),
      )
    } catch (error) {
      logger.warn(`resumeAiEditingConversation(${projectId}) cleanup failed`, error)
    }
    return {
      messages: target.messages.map((message) => ({ ...message })),
      agentTurns: structuredClone(target.agentTurns),
      loadedToolIds: [...target.loadedToolIds],
      context: target.context ? { ...target.context } : null,
      lastPromptTokens: target.lastPromptTokens ?? null,
    }
  } catch (error) {
    logger.error(`resumeAiEditingConversation(${projectId}, ${sessionId}) failed`, error)
    throw new Error('Failed to resume AI editing conversation')
  }
}
