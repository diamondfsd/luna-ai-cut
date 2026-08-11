import {
  archiveAiEditingConversation,
  clearAiEditingConversation,
  type AiEditingConversationState,
} from '@freecut/infrastructure/storage'

export async function archiveAndClearAiEditingConversation(
  projectId: string,
  state: AiEditingConversationState,
): Promise<void> {
  const firstMessage = state.messages[0]
  if (firstMessage) {
    await archiveAiEditingConversation(projectId, {
      id: firstMessage.id,
      createdAt: firstMessage.createdAt,
      archivedAt: Date.now(),
      ...state,
    })
  }
  await clearAiEditingConversation(projectId)
}
