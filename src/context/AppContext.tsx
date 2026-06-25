/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { AppSettings, ConnectionStatus, DownloadProgress } from '../shared/types'

interface AppContextValue {
  settings: AppSettings | null
  setSettings: (s: AppSettings | ((prev: AppSettings | null) => AppSettings | null)) => void
  connection: ConnectionStatus | null
  setConnection: (c: ConnectionStatus | null) => void
  downloadProgress: Map<string, DownloadProgress>
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, DownloadProgress>>>
}

const AppCtx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map())

  return (
    <AppCtx.Provider
      value={{
        settings,
        setSettings,
        connection,
        setConnection,
        downloadProgress,
        setDownloadProgress,
      }}
    >
      {children}
    </AppCtx.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
