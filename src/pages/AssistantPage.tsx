import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

import type { DeepSeekHarnessContext } from '../shared/types'
import { IconButton } from '../ui'
import './AssistantPage.css'

export function AssistantPage() {
  const context = useMemo<DeepSeekHarnessContext>(() => ({
    sessionId: crypto.randomUUID(),
    feature: 'assistant',
  }), [])
  const [webUrl, setWebUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const removeStateListener = window.luna.deepseekHarness.onWebState((state) => {
      if (!active || state.sessionId !== context.sessionId) return
      if (state.status === 'ready' && state.url) {
        setWebUrl(state.url)
        setError(null)
      } else if (state.status === 'error') {
        setWebUrl(null)
        setError(state.error ?? 'AI 助手启动失败。')
      }
    })

    void window.luna.deepseekHarness.getWebUrl(context).then((url) => {
      if (active) setWebUrl(url)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'AI 助手启动失败。')
    })

    return () => {
      active = false
      removeStateListener()
    }
  }, [context])

  return (
    <main className="assistant-page">
      <header className="assistant-page__header">
        <div>
          <h1>AI 助手</h1>
          <p>独立于剪辑器的 Luna 智能助手</p>
        </div>
        <IconButton
          variant="ghost"
          size="compact"
          icon={<X size={18} />}
          aria-label="关闭 AI 助手"
          title="关闭 AI 助手"
          onClick={() => void window.luna.deepseekHarness.closeWindow()}
        />
      </header>
      <section className="assistant-page__content">
        {webUrl ? (
          <iframe
            className="assistant-page__frame"
            src={webUrl}
            title="DeepSeek Harness AI 助手"
            allow="clipboard-read; clipboard-write"
          />
        ) : error ? (
          <div className="assistant-page__error" role="alert">
            <strong>AI 助手暂时无法打开</strong>
            <span>{error}</span>
          </div>
        ) : (
          <div className="assistant-page__loading">正在启动 AI 助手…</div>
        )}
      </section>
    </main>
  )
}
