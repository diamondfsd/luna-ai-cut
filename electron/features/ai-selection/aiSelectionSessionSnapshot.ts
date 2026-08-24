import type { AiSelectionSession } from '../../../src/shared/types'
import type { AiSelectionSnapshot } from './aiSelectionOperations'

export interface StoredAiSelectionSession extends AiSelectionSession {
  undoStack: AiSelectionSnapshot[]
  redoStack: AiSelectionSnapshot[]
  forceReanalysis?: boolean
}

export function publicAiSelectionSession(session: StoredAiSelectionSession): AiSelectionSession {
  const { undoStack, redoStack, forceReanalysis, ...value } = session
  void forceReanalysis
  return structuredClone({
    ...value,
    items: value.items.map((item) => ({ ...item, imageEmbedding: null, personEvidence: item.personEvidence ? { ...item.personEvidence, faces: item.personEvidence.faces?.map((face) => ({ ...face, embedding: null })) } : null })),
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
  })
}

export function restoreAiSelectionSnapshot(session: StoredAiSelectionSession, snapshot: AiSelectionSnapshot): void {
  session.preset = snapshot.preset
  session.purpose = snapshot.purpose
  session.target = structuredClone(snapshot.target)
  session.items = structuredClone(snapshot.items)
  session.scenes = structuredClone(snapshot.scenes)
  session.groups = structuredClone(snapshot.groups)
  session.preferenceProfile = structuredClone(snapshot.preferenceProfile)
}
