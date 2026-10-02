/** Build trusted, draft-only links. Do not truncate user requirements. */
export function buildWorkBuddyTaskUrl(prompt: string): string {
  if (prompt.length > 8000) throw new Error('任务要求过长，请缩短后重试')
  const url = new URL('workbuddy://task')
  url.searchParams.set('action', 'start')
  url.searchParams.set('prompt', prompt)
  return url.toString()
}

export function buildCodexTaskUrl(prompt: string): string {
  const url = new URL('codex://threads/new')
  url.searchParams.set('prompt', prompt)
  return url.toString()
}
