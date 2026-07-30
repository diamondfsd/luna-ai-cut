import { Smartphone, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { LocalMediaShareStatus } from '../shared/types'
import { Alert, Button, Dialog, IconButton, LoadingIndicator, Tooltip, toast } from '../ui'
import './SendToPhoneDialog.css'

const EMPTY_STATUS: LocalMediaShareStatus = {
  running: false,
  address: null,
  port: null,
  url: null,
  qrDataUrl: null,
  localCount: 0,
  exportCount: 0,
  startedAt: null,
}

type SharePhase = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export function SendToPhoneDialog() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LocalMediaShareStatus>(EMPTY_STATUS)
  const [phase, setPhase] = useState<SharePhase>('idle')
  const [error, setError] = useState('')
  const operationRef = useRef(0)
  const startingRef = useRef(false)

  useEffect(() => {
    void window.luna.localMediaShare.getStatus().then((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.running) setPhase('running')
    }).catch(() => undefined)
  }, [])

  const startSharing = useCallback(async () => {
    if (startingRef.current) return
    startingRef.current = true
    const operation = ++operationRef.current
    setPhase('starting')
    setError('')
    try {
      const current = await window.luna.localMediaShare.getStatus()
      const nextStatus = current.running ? current : await window.luna.localMediaShare.start()
      if (operation !== operationRef.current) return
      if (!nextStatus.running || !nextStatus.qrDataUrl) throw new Error('二维码生成失败，请重试')
      setStatus(nextStatus)
      setPhase('running')
    } catch (reason) {
      if (operation !== operationRef.current) return
      setStatus(EMPTY_STATUS)
      setError(reason instanceof Error ? reason.message : '无法开启发送，请检查当前网络')
      setPhase('error')
    } finally {
      startingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (phase !== 'running') return
    const timer = window.setInterval(() => {
      void window.luna.localMediaShare.getStatus().then((nextStatus) => {
        setStatus(nextStatus)
        if (!nextStatus.running) {
          setError('当前网络已发生变化，请重新开启发送')
          setPhase('error')
        }
      }).catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [phase])

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) void startSharing()
  }

  async function stopSharing(): Promise<void> {
    const operation = ++operationRef.current
    setPhase('stopping')
    try {
      await window.luna.localMediaShare.stop()
      if (operation !== operationRef.current) return
      setStatus(EMPTY_STATUS)
      setOpen(false)
      setPhase('idle')
    } catch {
      if (operation !== operationRef.current) return
      setPhase('running')
      toast.error('无法停止发送，请重试')
    }
  }

  const totalCount = status.localCount + status.exportCount
  const running = phase === 'running' && status.running && Boolean(status.qrDataUrl)

  return (
    <>
      <Tooltip content="发送到手机">
        <IconButton
          variant="ghost"
          size="mini"
          className="send-to-phone-trigger"
          data-running={status.running ? 'true' : undefined}
          icon={<Smartphone size={16} />}
          aria-label="发送到手机"
          aria-pressed={status.running}
          onClick={() => handleOpenChange(true)}
        />
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title="发送到手机"
        description="手机与电脑连接同一局域网后，扫描二维码即可浏览和下载资源。"
        className="send-to-phone-dialog"
        footer={running ? (
          <Button
            variant="danger"
            size="compact"
            icon={<Square size={13} />}
            onClick={() => void stopSharing()}
          >
            停止发送
          </Button>
        ) : phase === 'error' ? (
          <Button variant="primary" size="compact" onClick={() => void startSharing()}>重新开启</Button>
        ) : null}
      >
        <div className="send-to-phone-body" aria-live="polite">
          {running ? (
            <>
              <img className="send-to-phone-qr" src={status.qrDataUrl!} alt="发送到手机二维码" />
              <strong>使用手机扫描二维码</strong>
              <span>{totalCount} 个资源</span>
            </>
          ) : phase === 'error' ? (
            <Alert variant="error" message={error} />
          ) : (
            <LoadingIndicator label={phase === 'stopping' ? '正在停止发送' : '正在准备二维码'} />
          )}
        </div>
      </Dialog>
    </>
  )
}
