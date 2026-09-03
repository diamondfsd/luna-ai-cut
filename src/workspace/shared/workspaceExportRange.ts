export interface WorkspaceVideoExportRange {
  startTime: number
  endTime: number
}

export function resolveWorkspaceVideoExportRange(
  planStart: number,
  planEnd: number,
  trimStart: number,
  trimEnd: number | undefined,
  adjustable: boolean,
): WorkspaceVideoExportRange {
  const duration = Math.max(0.1, planEnd - planStart)
  if (!adjustable) return { startTime: planStart, endTime: planStart + duration }

  const relativeStart = Math.max(0, Math.min(trimStart, duration - 0.1))
  const relativeEnd = Math.max(
    relativeStart + 0.1,
    Math.min(trimEnd ?? duration, duration),
  )
  return {
    startTime: planStart + relativeStart,
    endTime: planStart + relativeEnd,
  }
}
