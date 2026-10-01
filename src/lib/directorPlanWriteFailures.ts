export interface DirectorPlanWriteFailure {
  planId: string
  title: string
  message: string
  key: string
}

export function isPermanentDirectorPlanWriteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /HTTP\s+(?:400|404|405|413|415|422|501)\b/.test(message) || message.includes('（invalid-plan-update）')
    || message.includes('手机未保存片段标记')
}

export class DirectorPlanWriteFailures {
  private failures = new Map<string, DirectorPlanWriteFailure>()
  blocked(planId: string, key: string): DirectorPlanWriteFailure | undefined {
    const failure = this.failures.get(planId)
    return failure?.key === key ? failure : undefined
  }
  record(planId: string, title: string, key: string, error: unknown): boolean {
    if (!isPermanentDirectorPlanWriteError(error)) return false
    const message = error instanceof Error ? error.message : String(error)
    const changed = this.failures.get(planId)?.key !== key
    this.failures.set(planId, { planId, title, key, message })
    return changed
  }
  remove(planId: string) { this.failures.delete(planId) }
  clear() { this.failures.clear() }
  entries() { return [...this.failures.values()] }
}
