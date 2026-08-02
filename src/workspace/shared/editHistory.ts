import type { EditPipeline } from './editPipeline'

export interface EditHistory {
  past: EditPipeline[]
  present: EditPipeline
  future: EditPipeline[]
  activeGroup: string | null
}

export interface HistoryGroup {
  key: string
  finalize?: boolean
}

export function createEditHistory(initial: EditPipeline): EditHistory {
  return {
    past: [],
    present: structuredClone(initial),
    future: [],
    activeGroup: null,
  }
}

export function pushHistory(history: EditHistory, next: EditPipeline, group?: HistoryGroup): EditHistory {
  const continuesGroup = Boolean(group && history.activeGroup === group.key)
  return {
    past: continuesGroup
      ? history.past
      : [...history.past, structuredClone(history.present)].slice(-60),
    present: structuredClone(next),
    future: [],
    activeGroup: group && !group.finalize ? group.key : null,
  }
}

export function mapHistoryPipelines(
  history: EditHistory,
  update: (pipeline: EditPipeline) => EditPipeline,
): EditHistory {
  return {
    past: history.past.map((pipeline) => structuredClone(update(pipeline))),
    present: structuredClone(update(history.present)),
    future: history.future.map((pipeline) => structuredClone(update(pipeline))),
    activeGroup: null,
  }
}

export function collectHistoryMaskPaths(history: EditHistory): string[] {
  const paths = new Set<string>()
  for (const pipeline of [...history.past, history.present, ...history.future]) {
    for (const layer of [...pipeline.colorMasks, ...pipeline.beautyMasks]) {
      if (layer.path) paths.add(layer.path)
      for (const component of layer.components ?? []) {
        if (component.type === 'raster' && component.path) paths.add(component.path)
      }
    }
  }
  return [...paths]
}

export function undoHistory(history: EditHistory): EditHistory {
  const previous = history.past[history.past.length - 1]
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: structuredClone(previous),
    future: [structuredClone(history.present), ...history.future],
    activeGroup: null,
  }
}

export function redoHistory(history: EditHistory): EditHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, structuredClone(history.present)],
    present: structuredClone(next),
    future: history.future.slice(1),
    activeGroup: null,
  }
}

export function resetHistory(history: EditHistory, next: EditPipeline): EditHistory {
  return {
    past: [...history.past, structuredClone(history.present)].slice(-60),
    present: structuredClone(next),
    future: [],
    activeGroup: null,
  }
}
