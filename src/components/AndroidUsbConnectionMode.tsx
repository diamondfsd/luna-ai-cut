import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Select, toast } from '../ui'
import type { AndroidConnectionMode, LiveStreamStatus } from '../shared/types'
import './AndroidUsbConnectionMode.css'

export function AndroidUsbConnectionMode({ status, onChanged }: { status: LiveStreamStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [fallback, setFallback] = useState<'probing' | 'connected' | 'failed' | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const handledFailure = useRef<string | null>(null)
  const attempt = useRef(0)

  useEffect(() => () => { attempt.current += 1 }, [])

  useEffect(() => {
    if (!status.startedAt || status.state === 'stopping') {
      attempt.current += 1
      handledFailure.current = null
      setFallback(null)
      setDialogOpen(false)
      setBusy(false)
      return
    }
    if (status.platform !== 'win32' || status.transport !== 'usb-aoa' || status.usbState !== 'error') return
    const key = `${status.startedAt}:${status.error}`
    if (handledFailure.current === key || busy) return
    handledFailure.current = key
    const generation = ++attempt.current
    setBusy(true)
    setFallback('probing')
    void window.luna.liveStream.setAndroidConnectionMode('adb').then(() => {
      if (generation === attempt.current) onChanged()
    }).catch(() => {
      if (generation !== attempt.current) return
      setFallback('failed')
      setDialogOpen(true)
    }).finally(() => {
      if (generation === attempt.current) setBusy(false)
    })
  }, [status.startedAt, status.state, status.platform, status.transport, status.usbState, status.error, busy, onChanged])

  useEffect(() => {
    if (fallback !== 'probing' || busy) return
    if (status.transport === 'android-adb' && status.receiverConnected) {
      setFallback('connected')
      setDialogOpen(true)
      return
    }
    const timer = window.setTimeout(() => {
      setFallback('failed')
      setDialogOpen(true)
    }, 15_000)
    return () => window.clearTimeout(timer)
  }, [fallback, busy, status.transport, status.receiverConnected])

  useEffect(() => {
    if (fallback === 'failed' && status.transport === 'android-adb' && status.receiverConnected) setFallback('connected')
  }, [fallback, status.transport, status.receiverConnected])

  if (status.platform !== 'win32') return null

  const retryAdb = async () => {
    if (busy) return
    const generation = ++attempt.current
    setBusy(true)
    setFallback('probing')
    try {
      await window.luna.liveStream.setAndroidConnectionMode('adb')
      if (generation === attempt.current) onChanged()
    } catch {
      if (generation === attempt.current) setFallback('failed')
    } finally {
      if (generation === attempt.current) setBusy(false)
    }
  }

  const changeMode = async (mode: string) => {
    if (busy || (mode !== 'aoa' && mode !== 'adb')) return
    setBusy(true)
    attempt.current += 1
    setFallback(null)
    setDialogOpen(false)
    try {
      await window.luna.liveStream.setAndroidConnectionMode(mode as AndroidConnectionMode)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接方式切换失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="android-usb-connection-mode">
      <Select
        variant="compact"
        placeholder="安卓连接"
        options={[{ value: 'aoa', label: '标准连接' }, { value: 'adb', label: 'USB 调试' }]}
        value={status.androidConnectionMode}
        onValueChange={(mode) => void changeMode(mode)}
        disabled={busy || status.receiverConnected || status.captureActive || status.state === 'starting' || status.state === 'stopping'}
      />
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="标准连接失败"
        description={fallback === 'connected'
          ? '已切换到 USB 调试连接'
          : fallback === 'probing' ? '正在尝试 USB 调试连接' : '请开启手机开发者模式和 USB 调试，允许调试并重新插线。'}
        footer={<>
          <Button variant="secondary" onClick={() => setDialogOpen(false)}>关闭</Button>
          {fallback !== 'connected' && <Button variant="primary" disabled={busy || fallback === 'probing'} onClick={() => void retryAdb()}>重试 ADB</Button>}
        </>}
      />
    </div>
  )
}
