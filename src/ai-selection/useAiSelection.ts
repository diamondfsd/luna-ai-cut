import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiSelectionPreset, AiSelectionPurpose, AiSelectionSession, AiSelectionSource, AiSelectionTarget, AiSelectionUserOperation } from '../shared/types'
import { toast } from '../ui'

interface IncomingSelectionState {
  paths?: string[]
  label?: string
}

export function useAiSelection() {
  const location = useLocation()
  const incoming = location.state as IncomingSelectionState | null
  const startedIncoming = useRef(false)
  const [sessions, setSessions] = useState<AiSelectionSession[]>([])
  const [session, setSession] = useState<AiSelectionSession | null>(null)
  const [preset, setPreset] = useState<AiSelectionPreset>('balanced')
  const [purpose, setPurpose] = useState<AiSelectionPurpose>('general')
  const [target, setTarget] = useState<AiSelectionTarget>({ mode: 'preset', value: null })
  const [busy, setBusy] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)

  const upsert = useCallback((next: AiSelectionSession) => {
    setSessions((current) => [next, ...current.filter((item) => item.id !== next.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)))
    setSession((current) => current?.id === next.id ? next : current)
  }, [])

  useEffect(() => {
    void window.luna.aiSelection.listSessions().then((next) => {
      setSessions(next)
    }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoadingSessions(false))
    const offSession = window.luna.aiSelection.onSessionUpdated(upsert)
    return offSession
  }, [upsert])

  useEffect(() => {
    if (!incoming?.paths?.length || startedIncoming.current) return
    startedIncoming.current = true
    setBusy(true)
    void window.luna.aiSelection.start({
      name: incoming.label ?? '本地资源 AI 选片',
      source: { kind: 'files', label: incoming.label ?? '本地资源', paths: incoming.paths },
      preset,
      purpose,
      target,
    }).then((next) => { upsert(next); setSession(next) })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }, [incoming, preset, purpose, target, upsert])

  async function selectSession(id: string): Promise<void> {
    const next = sessions.find((item) => item.id === id) ?? await window.luna.aiSelection.getSession(id)
    setSession(next)
    if (next) { setPreset(next.preset); setPurpose(next.purpose); setTarget(next.target) }
  }

  function closeSession(): void {
    setSession(null)
  }

  async function startTask(source: AiSelectionSource, name?: string, options?: { preset: AiSelectionPreset; purpose: AiSelectionPurpose; target: AiSelectionTarget }): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const next = await window.luna.aiSelection.start({
        name: name?.trim() || `${source.label} AI 选片`,
        source,
        preset: options?.preset ?? preset,
        purpose: options?.purpose ?? purpose,
        target: options?.target ?? target,
      })
      upsert(next)
      setSession(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function removeSession(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await window.luna.aiSelection.removeSession(id)
      setSessions((current) => current.filter((item) => item.id !== id))
      if (session?.id === id) closeSession()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<AiSelectionSession>): Promise<void> {
    if (!session || busy) return
    setBusy(true)
    try { upsert(await action()) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  const controls = useMemo(() => ({
    pause: () => run(() => window.luna.aiSelection.pause(session!.id)),
    resume: () => run(() => window.luna.aiSelection.resume(session!.id)),
    cancel: () => run(() => window.luna.aiSelection.cancel(session!.id)),
    undo: () => run(() => window.luna.aiSelection.undo(session!.id)),
    redo: () => run(() => window.luna.aiSelection.redo(session!.id)),
    apply: (operation: AiSelectionUserOperation) => run(() => window.luna.aiSelection.applyOperation(session!.id, session!.revision, operation)),
    analyzePeople: (itemIds: string[]) => run(() => window.luna.aiSelection.analyzePeople(session!.id, itemIds)),
    analyzeContentTags: (itemIds: string[] = []) => run(() => window.luna.aiSelection.analyzeContentTags(session!.id, itemIds)),
    analyzeVideos: (itemIds: string[]) => run(() => window.luna.aiSelection.analyzeVideos(session!.id, itemIds)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [session, busy])

  return {
    sessions,
    session,
    preset,
    setPreset,
    purpose,
    setPurpose,
    target,
    setTarget,
    busy,
    loadingSessions,
    selectSession,
    closeSession,
    startTask,
    removeSession,
    controls,
  }
}
