// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  archiveAiEditingConversation,
  listAiEditingConversationHistory,
  loadAiEditingConversation,
  resumeAiEditingConversation,
  saveAiEditingConversation,
} from './ai-editing-conversation'
import { writeJsonAtomic } from './fs-primitives'
import { projectAiEditingConversationPath } from './paths'
import { setWorkspaceRoot } from './root'
import { asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('AI editing conversation storage', () => {
  it('persists each message with its creation time', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const messages = [
      {
        id: 'message-1',
        role: 'user' as const,
        content: '整理开场片段',
        createdAt: 1_723_456_789_000,
      },
    ]

    await saveAiEditingConversation('project-42', messages)

    expect(await loadAiEditingConversation('project-42')).toEqual(messages)
    expect(
      JSON.parse(
        (await readFileText(root, 'projects', 'project-42', 'ai-editing-conversation.json')) ??
          '{}',
      ),
    ).toMatchObject({ version: 2, messages })
  })

  it('rejects messages that do not have a valid creation time', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await writeJsonAtomic(
      root as unknown as FileSystemDirectoryHandle,
      projectAiEditingConversationPath('project-42'),
      {
        version: 2,
        messages: [{ id: 'message-1', role: 'assistant', content: '已完成。' }],
      },
    )

    expect(await loadAiEditingConversation('project-42')).toEqual([])
  })

  it('stores archived sessions separately and lists the newest session first', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await archiveAiEditingConversation('project-42', {
      id: 'older-session',
      createdAt: 1_723_456_789_000,
      archivedAt: 1_723_456_790_000,
      messages: [
        { id: 'message-1', role: 'user', content: '整理开场片段', createdAt: 1_723_456_789_000 },
      ],
    })
    await archiveAiEditingConversation('project-42', {
      id: 'newer-session',
      createdAt: 1_723_456_800_000,
      archivedAt: 1_723_456_801_000,
      messages: [
        { id: 'message-2', role: 'assistant', content: '已完成。', createdAt: 1_723_456_800_000 },
      ],
    })

    expect(
      (await listAiEditingConversationHistory('project-42')).map((session) => session.id),
    ).toEqual(['newer-session', 'older-session'])
  })

  it('resumes an archived session and archives the previous current conversation', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const currentMessages = [
      { id: 'current-message', role: 'user' as const, content: '当前问题', createdAt: 200 },
    ]
    const archivedMessages = [
      { id: 'archived-message', role: 'user' as const, content: '继续旧问题', createdAt: 100 },
      { id: 'archived-reply', role: 'assistant' as const, content: '旧回答', createdAt: 110 },
    ]
    await saveAiEditingConversation('project-42', currentMessages)
    await archiveAiEditingConversation('project-42', {
      id: 'archived-message',
      createdAt: 100,
      archivedAt: 150,
      messages: archivedMessages,
    })

    expect(await resumeAiEditingConversation('project-42', 'archived-message')).toEqual(
      archivedMessages,
    )
    expect(await loadAiEditingConversation('project-42')).toEqual(archivedMessages)
    const history = await listAiEditingConversationHistory('project-42')
    expect(history).toHaveLength(1)
    expect(history[0]?.id).toBe('current-message')
    expect(history[0]?.messages).toEqual(currentMessages)
  })

  it('resumes into an empty current conversation without leaving a duplicate', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const archivedMessages = [
      { id: 'archived-message', role: 'user' as const, content: '继续旧问题', createdAt: 100 },
    ]
    await archiveAiEditingConversation('project-42', {
      id: 'archived-message',
      createdAt: 100,
      archivedAt: 150,
      messages: archivedMessages,
    })

    await resumeAiEditingConversation('project-42', 'archived-message')

    expect(await loadAiEditingConversation('project-42')).toEqual(archivedMessages)
    expect(await listAiEditingConversationHistory('project-42')).toEqual([])
  })
})
