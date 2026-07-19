import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiSelectionMode, AiSelectionPurpose, AiSelectionSession, AiSelectionUserOperation, AiSelectionWorkflow } from '../shared/types'
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
  const [activeId, setActiveId] = useState('')
  const [session, setSession] = useState<AiSelectionSession | null>(null)
  const [mode, setMode] = useState<AiSelectionMode>('balanced')
  const [purpose, setPurpose] = useState<AiSelectionPurpose>('general')
  const [workflow, setWorkflow] = useState<AiSelectionWorkflow>('assist')
  const [busy, setBusy] = useState(false)

  const upsert = useCallback((next: AiSelectionSession) => {
    setSessions((current) => [next, ...current.filter((item) => item.id !== next.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)))
    setSession((current) => current?.id === next.id || !current ? next : current)
  }, [])

  useEffect(() => {
    void window.luna.aiSelection.listSessions().then((next) => {
      setSessions(next)
      if (!activeId && next[0]) { setActiveId(next[0].id); setSession(next[0]); setMode(next[0].mode); setPurpose(next[0].purpose); setWorkflow(next[0].workflow) }
    }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
    const offSession = window.luna.aiSelection.onSessionUpdated(upsert)
    return offSession
  }, [activeId, upsert])

  useEffect(() => {
    if (!incoming?.paths?.length || startedIncoming.current) return
    startedIncoming.current = true
    setBusy(true)
    void window.luna.aiSelection.start({
      name: incoming.label ?? '本地资源 AI 选片',
      source: { kind: 'files', label: incoming.label ?? '本地资源', paths: incoming.paths },
      mode,
      purpose,
      workflow,
    }).then((next) => { upsert(next); setActiveId(next.id); setSession(next) })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }, [incoming, mode, purpose, upsert, workflow])

  async function selectSession(id: string): Promise<void> {
    setActiveId(id)
    const next = sessions.find((item) => item.id === id) ?? await window.luna.aiSelection.getSession(id)
    setSession(next)
    if (next) { setMode(next.mode); setPurpose(next.purpose); setWorkflow(next.workflow) }
  }

  async function startDirectory(): Promise<void> {
    const directory = await window.luna.aiSelection.chooseDirectory()
    if (!directory) return
    setBusy(true)
    try {
      const parts = directory.split(/[\\/]/).filter(Boolean)
      const label = parts[parts.length - 1] ?? '素材目录'
      const next = await window.luna.aiSelection.start({ name: `${label} AI 选片`, source: { kind: 'directory', directory, label }, mode, purpose, workflow })
      upsert(next)
      setActiveId(next.id)
      setSession(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
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

  return { sessions, activeId, session, mode, setMode, purpose, setPurpose, workflow, setWorkflow, busy, selectSession, startDirectory, controls }
}
