import type { EditPipeline } from './editPipeline'

export interface EditHistory {
  past: EditPipeline[]
  present: EditPipeline
  future: EditPipeline[]
}

export function createEditHistory(initial: EditPipeline): EditHistory {
  return {
    past: [],
    present: structuredClone(initial),
    future: [],
  }
}

export function pushHistory(history: EditHistory, next: EditPipeline): EditHistory {
  return {
    past: [...history.past, structuredClone(history.present)].slice(-60),
    present: structuredClone(next),
    future: [],
  }
}

export function undoHistory(history: EditHistory): EditHistory {
  const previous = history.past[history.past.length - 1]
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: structuredClone(previous),
    future: [structuredClone(history.present), ...history.future],
  }
}

export function redoHistory(history: EditHistory): EditHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, structuredClone(history.present)],
    present: structuredClone(next),
    future: history.future.slice(1),
  }
}

export function resetHistory(history: EditHistory, next: EditPipeline): EditHistory {
  return {
    past: [...history.past, structuredClone(history.present)].slice(-60),
    present: structuredClone(next),
    future: [],
  }
}
