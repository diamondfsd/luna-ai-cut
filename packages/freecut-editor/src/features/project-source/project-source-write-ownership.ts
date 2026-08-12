let aiEditingWriterCount = 0

export function acquireAiEditingSourceWriteOwnership(): () => void {
  aiEditingWriterCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    aiEditingWriterCount = Math.max(0, aiEditingWriterCount - 1)
  }
}

export function isAiEditingSourceWriteOwned(): boolean {
  return aiEditingWriterCount > 0
}
