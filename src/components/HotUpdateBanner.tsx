import { useEffect, useState } from 'react'
import { FileText, RefreshCw, X as XIcon, Zap } from 'lucide-react'
import type { HotUpdateCheckResult } from '../shared/types'
import { Button } from '../ui/Button'

type Phase = 'idle' | 'downloading' | 'ready' | 'done'

export function HotUpdateBanner() {
  const [hotInfo, setHotInfo] = useState<HotUpdateCheckResult | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)

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
    <>
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
              {hotInfo.notes && (
                <Button variant="ghost" size="mini" onClick={() => setShowNotes(true)}>
                  <FileText size={12} />
                  更新内容
                </Button>
              )}
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
              <Button variant="secondary" size="compact" onClick={() => { setDismissed(true); setPhase('done') }}>
                稍后再说
              </Button>
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

      {/* 更新内容弹窗 */}
      {showNotes && hotInfo?.notes && (
        <div className="update-notes-overlay" onClick={() => setShowNotes(false)}>
          <div className="update-notes-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="update-notes-header">
              <h3>更新内容 · v{hotInfo.version}</h3>
              <button className="update-banner-close" onClick={() => setShowNotes(false)} aria-label="关闭">
                <XIcon size={16} />
              </button>
            </div>
            <div className="update-notes-body">
              {hotInfo.notes.split('\n').map((line, i) => (
                <p key={i} className={line.startsWith('#') ? 'notes-heading' : line.startsWith('-') ? 'notes-item' : ''}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
