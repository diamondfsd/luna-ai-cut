import { useEffect, useMemo, useState } from 'react'

import { App } from './app'
import { i18nReady } from './i18n'
import {
  EmbeddedHostProvider,
  type ImportMediaFiles,
} from './shared/host/embedded-host'
import './index.css'

export interface FreeCutEditorProps {
  onRequestMediaImport?: (importFiles: ImportMediaFiles) => void
}

export function FreeCutEditor({ onRequestMediaImport }: FreeCutEditorProps) {
  const [ready, setReady] = useState(false)
  const hostBridge = useMemo(
    () => ({ requestMediaImport: onRequestMediaImport }),
    [onRequestMediaImport],
  )

  useEffect(() => {
    document.body.classList.add('freecut-active')
    let active = true
    void i18nReady.then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
      document.body.classList.remove('freecut-active')
    }
  }, [])

  if (!ready) return null

  return (
    <EmbeddedHostProvider bridge={hostBridge}>
      <div className="freecut-app dark size-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
        <App />
      </div>
    </EmbeddedHostProvider>
  )
}
