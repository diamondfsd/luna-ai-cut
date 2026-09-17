import { useEffect, useState } from 'react'
import { RefreshCw, Zap } from 'lucide-react'

import type { HotUpdateCheckResult } from '../shared/types'
import { Button, Dialog, MarkdownViewer } from '../ui'
import { logger } from '../lib/rendererLogger'
import '../styles/hot-update-startup-dialog.css'

type Phase = 'idle' | 'downloading' | 'ready' | 'error'

export function HotUpdateStartupDialog() {
  const [hotInfo, setHotInfo] = useState<HotUpdateCheckResult | null>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const notes = hotInfo?.notes?.replace(/^# .+(?:\r?\n)+/, '').trim()

  useEffect(() => {
    let cancelled = false
    logger.info('[热更新弹窗] 开始读取启动检查结果')
    void window.luna.getAutomaticHotUpdate().then((result) => {
      logger.info('[热更新弹窗] 启动检查结果', { cancelled, hasUpdate: Boolean(result), version: result?.version ?? null })
      if (cancelled || !result) return
      setHotInfo(result)
      setOpen(true)
    }).catch((cause) => logger.error('[热更新弹窗] 读取启动检查结果失败', cause))
    return () => { cancelled = true }
  }, [])

  async function applyUpdate(): Promise<void> {
    if (!hotInfo) return
    setPhase('downloading')
    setError(null)
    try {
      const result = await window.luna.applyHotUpdate(hotInfo)
      if (result.success) setPhase('ready')
      else { setError(result.error ?? '更新失败'); setPhase('error') }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      className="hot-update-startup-dialog"
      title={phase === 'ready' ? '更新已准备好' : `发现新版本 v${hotInfo?.version ?? ''}`}
      description={phase === 'ready' ? '重启应用后生效' : '有新的应用改进可用'}
      footer={(
        <>
          {phase === 'idle' && <Button variant="secondary" size="compact" onClick={() => setOpen(false)}>稍后再说</Button>}
          {phase === 'idle' && <Button variant="primary" size="compact" icon={<Zap size={14} />} onClick={() => void applyUpdate()}>立即更新</Button>}
          {phase === 'downloading' && <span>正在下载更新...</span>}
          {phase === 'ready' && <Button variant="primary" size="compact" icon={<RefreshCw size={14} />} onClick={() => void window.luna.relaunchApp()}>立即重启</Button>}
          {phase === 'error' && <Button variant="secondary" size="compact" onClick={() => void applyUpdate()}>重试</Button>}
        </>
      )}
    >
      <div className="ui-dialog-body hot-update-startup-body">
        {phase === 'downloading' && <p>正在下载更新，请稍候。</p>}
        {phase === 'error' && <p>{error}</p>}
        {phase === 'idle' && notes && <MarkdownViewer content={notes} />}
      </div>
    </Dialog>
  )
}
