import { useEffect, useState } from 'react'
import { RefreshCw, Zap } from 'lucide-react'
import type { HotUpdateCheckResult } from '../shared/types'
import { Button } from '../ui/Button'

type Phase = 'idle' | 'downloading' | 'ready' | 'done'

export function HotUpdateBanner() {
  const [hotInfo, setHotInfo] = useState<HotUpdateCheckResult | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 监听主进程推送的热更新通知
    const unsub = window.luna.onHotUpdateAvailable((info) => {
      setHotInfo(info)
      setDismissed(false)
      setPhase('idle')
      setError(null)
    })
    return unsub
  }, [])

  if (!hotInfo || dismissed) return null

  async function handleApply(): Promise<void> {
    if (!hotInfo) return
    setPhase('downloading')
    setError(null)
    try {
      const result = await window.luna.applyHotUpdate(hotInfo)
      if (result.success) {
        setPhase('ready')
      } else {
        setError(result.error ?? '应用失败')
        setPhase('done')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('done')
    }
  }

  function handleRelaunch(): void {
    void window.luna.relaunchApp()
  }

  return (
    <div className="update-banner">
      <span className="update-banner-text">
        <Zap size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        {phase === 'downloading' && '正在下载热更新...'}
        {phase === 'ready' && '热更新已就绪，重启后生效'}
        {phase === 'done' && error
          ? `热更新失败: ${error}`
          : <>热更新 <strong>v{hotInfo.version}</strong> 可用</>
        }
      </span>
      <div className="update-banner-actions">
        {phase === 'idle' && (
          <>
            <Button variant="primary" size="compact" onClick={() => void handleApply()}>
              <Zap size={14} />
              立即更新
            </Button>
            <button className="update-banner-close" onClick={() => setDismissed(true)} aria-label="关闭">
              ✕
            </button>
          </>
        )}
        {phase === 'downloading' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888' }}>
            <RefreshCw size={14} className="spin" />
            下载中...
          </span>
        )}
        {phase === 'ready' && (
          <>
            <Button variant="primary" size="compact" onClick={handleRelaunch}>
              <RefreshCw size={14} />
              立即重启
            </Button>
            <button className="update-banner-close" onClick={() => { setDismissed(true); setPhase('done') }} aria-label="稍后">
              稍后
            </button>
          </>
        )}
        {phase === 'done' && error && (
          <>
            <Button variant="secondary" size="compact" onClick={() => void handleApply()}>
              重试
            </Button>
            <button className="update-banner-close" onClick={() => setDismissed(true)} aria-label="关闭">
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}
