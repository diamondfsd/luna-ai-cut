/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import type { NasSyncStatus } from '../shared/types'
import { useApp } from './AppContext'

const emptyStatus: NasSyncStatus = {
  state: 'disabled',
  totalFiles: 0,
  completedFiles: 0,
  pendingFiles: 0,
  failedFiles: 0,
  canceledFiles: 0,
  totalBytes: 0,
  completedBytes: 0,
  currentFileName: null,
  currentDownloadedBytes: 0,
  currentTotalBytes: null,
  speedBps: 0,
  percent: 100,
  remotePath: null,
  lastSyncedAt: null,
  lastError: null,
  updatedAt: new Date(0).toISOString(),
  failedItems: [],
  taskItems: [],
  taskItemsTruncated: false,
}

interface NasSyncProgressContextValue {
  status: NasSyncStatus
  refresh: () => Promise<void>
  progressPopoverOpen: boolean
  setProgressPopoverOpen: (open: boolean) => void
  showProgress: () => void
}

const Ctx = createContext<NasSyncProgressContextValue | null>(null)

export function NasSyncProgressProvider({ children }: { children: ReactNode }) {
  const { settings } = useApp()
  const [status, setStatus] = useState<NasSyncStatus>(emptyStatus)
  const [progressPopoverOpen, setProgressPopoverOpen] = useState(false)
  const previousState = useRef<NasSyncStatus['state']>(emptyStatus.state)

  useEffect(() => {
    let canceled = false
    const refresh = async (): Promise<void> => {
      const next = await window.luna.nasSync.getStatus().catch(() => null)
      if (!canceled && next) setStatus(next)
    }
    void refresh()
    const offIpc = window.luna.onNasSyncProgress((next) => setStatus(next))
    return () => {
      canceled = true
      offIpc()
    }
  }, [settings])

  useEffect(() => {
    if (status.state === 'syncing' && previousState.current !== 'syncing') setProgressPopoverOpen(true)
    previousState.current = status.state
  }, [status.state])

  const showProgress = useCallback((): void => setProgressPopoverOpen(true), [])

  return (
    <Ctx.Provider value={{
      status,
      refresh: async () => setStatus(await window.luna.nasSync.getStatus()),
      progressPopoverOpen,
      setProgressPopoverOpen,
      showProgress,
    }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useNasSyncProgress(): NasSyncProgressContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNasSyncProgress must be used inside NasSyncProgressProvider')
  return ctx
}
