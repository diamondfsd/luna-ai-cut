import { createContext, useContext, type ReactNode } from 'react'

export type ImportMediaFiles = (files: File[]) => Promise<void>

export interface EmbeddedHostBridge {
  requestMediaImport?: (importFiles: ImportMediaFiles) => void
}

const EmbeddedHostContext = createContext<EmbeddedHostBridge>({})

export function EmbeddedHostProvider({
  bridge,
  children,
}: {
  bridge: EmbeddedHostBridge
  children: ReactNode
}) {
  return <EmbeddedHostContext.Provider value={bridge}>{children}</EmbeddedHostContext.Provider>
}

export function useEmbeddedHost(): EmbeddedHostBridge {
  return useContext(EmbeddedHostContext)
}
