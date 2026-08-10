// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import { loadAiEditingConversation, saveAiEditingConversation } from './ai-editing-conversation'
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
})
