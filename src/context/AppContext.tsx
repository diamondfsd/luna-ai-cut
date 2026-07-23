/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { AppSettings, ConnectionStatus } from '../shared/types'

interface AppContextValue {
  settings: AppSettings | null
  setSettings: (s: AppSettings | ((prev: AppSettings | null) => AppSettings | null)) => void
  connection: ConnectionStatus | null
  setConnection: (c: ConnectionStatus | null) => void
  /** 隐藏开发模式 — 在设置页连点 5 次相机地址激活，重启后失效 */
  hiddenDevMode: boolean
  setHiddenDevMode: (v: boolean) => void
}

const AppCtx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [hiddenDevMode, setHiddenDevMode] = useState(false)

  return (
    <AppCtx.Provider
      value={{
        settings,
        setSettings,
        connection,
        setConnection,
        hiddenDevMode,
        setHiddenDevMode,
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
