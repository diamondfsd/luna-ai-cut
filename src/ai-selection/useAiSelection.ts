import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiSelectionPreset, AiSelectionPurpose, AiSelectionSession, AiSelectionSource, AiSelectionTarget, AiSelectionUserOperation } from '../shared/types'
import { toast } from '../ui'

interface IncomingSelectionState {
  paths?: string[]
  label?: string
}

interface PeopleAnalysisState {
  running: boolean
  completed: number
  total: number
  currentLabel: string | null
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
  const [peopleAnalysis, setPeopleAnalysis] = useState<PeopleAnalysisState>({ running: false, completed: 0, total: 0, currentLabel: null })
  const peopleAnalysisRef = useRef<{ sessionId: string; completed: number; total: number } | null>(null)

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
    const offProgress = window.luna.aiSelection.onProgress((progress) => {
      const active = peopleAnalysisRef.current
      if (!active || active.sessionId !== progress.sessionId || !progress.currentLabel) return
      active.completed = Math.min(active.total, active.completed + 1)
      setPeopleAnalysis({ running: true, completed: active.completed, total: active.total, currentLabel: progress.currentLabel })
    })
    return () => { offSession(); offProgress() }
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

  async function run(action: () => Promise<AiSelectionSession>): Promise<boolean> {
    if (!session || busy) return false
    setBusy(true)
    try {
      upsert(await action())
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
    finally { setBusy(false) }
  }

  async function analyzePeople(itemIds: string[]): Promise<void> {
    if (!session || busy || itemIds.length === 0) return
    const analysis = { sessionId: session.id, completed: 0, total: itemIds.length }
    peopleAnalysisRef.current = analysis
    setPeopleAnalysis({ running: true, completed: 0, total: itemIds.length, currentLabel: null })
    setBusy(true)
    try {
      upsert(await window.luna.aiSelection.analyzePeople(session.id, itemIds))
      setPeopleAnalysis({ running: false, completed: itemIds.length, total: itemIds.length, currentLabel: null })
    } catch (error) {
      setPeopleAnalysis((current) => ({ ...current, running: false }))
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      peopleAnalysisRef.current = null
      setBusy(false)
    }
  }

  const controls = useMemo(() => ({
    pause: () => run(() => window.luna.aiSelection.pause(session!.id)),
    resume: () => run(() => window.luna.aiSelection.resume(session!.id)),
    cancel: () => run(() => window.luna.aiSelection.cancel(session!.id)),
    undo: () => run(() => window.luna.aiSelection.undo(session!.id)),
    redo: () => run(() => window.luna.aiSelection.redo(session!.id)),
    apply: (operation: AiSelectionUserOperation) => run(() => window.luna.aiSelection.applyOperation(session!.id, session!.revision, operation)),
    analyzePeople,
    renamePerson: (groupId: string, name: string) => run(() => window.luna.aiSelection.renamePerson(session!.id, groupId, name)),
    mergePeople: (targetGroupId: string, sourceGroupId: string) => run(() => window.luna.aiSelection.mergePeople(session!.id, targetGroupId, sourceGroupId)),
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
    peopleAnalysis,
    loadingSessions,
    selectSession,
    closeSession,
    startTask,
    removeSession,
    controls,
  }
}
