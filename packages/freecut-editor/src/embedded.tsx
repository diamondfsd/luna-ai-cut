import { useEffect, useState } from 'react'

import { App } from './app'
import { i18nReady } from './i18n'
import './index.css'

export function FreeCutEditor() {
  const [ready, setReady] = useState(false)

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
    <div className="freecut-app dark size-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
      <App />
    </div>
  )
}
