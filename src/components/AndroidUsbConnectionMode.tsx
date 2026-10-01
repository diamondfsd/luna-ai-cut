import { useState } from 'react'
import { Select, toast } from '../ui'
import type { AndroidConnectionMode, LiveStreamStatus } from '../shared/types'
import './AndroidUsbConnectionMode.css'

export function AndroidUsbConnectionMode({ status, onChanged }: { status: LiveStreamStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  if (status.platform !== 'win32') return null

  const changeMode = async (mode: string) => {
    if (busy || (mode !== 'aoa' && mode !== 'adb')) return
    setBusy(true)
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
    </div>
  )
}
