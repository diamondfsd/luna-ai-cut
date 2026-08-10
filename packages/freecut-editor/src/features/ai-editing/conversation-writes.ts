const conversationWrites = new Map<string, Promise<void>>()

export function waitForAiEditingConversationWrites(projectId: string): Promise<void> {
  return conversationWrites.get(projectId) ?? Promise.resolve()
}

export function enqueueAiEditingConversationWrite<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = waitForAiEditingConversationWrites(projectId)
  const next = previous.catch(() => undefined).then(operation)
  const completion = next.then(() => undefined, () => undefined)
  conversationWrites.set(projectId, completion)
  void completion.then(() => {
    if (conversationWrites.get(projectId) === completion) conversationWrites.delete(projectId)
  })
  return next
}
