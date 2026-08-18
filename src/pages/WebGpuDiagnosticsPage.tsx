import { useCallback, useEffect, useState } from 'react'

import { Button } from '../ui'
import { collectWebGpuDiagnostics, type WebGpuDiagnosticsSnapshot } from '../lib/webgpu/diagnostics'
import '../styles/webgpu-diagnostics.css'

export function WebGpuDiagnosticsPage() {
  const [snapshot, setSnapshot] = useState<WebGpuDiagnosticsSnapshot | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runDiagnostics = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      setSnapshot(await collectWebGpuDiagnostics())
    } catch (reason: unknown) {
      setSnapshot(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    void runDiagnostics()
  }, [runDiagnostics])

  return (
    <main className="webgpu-diagnostics-page">
      <header className="webgpu-diagnostics-header">
        <div>
          <p className="webgpu-diagnostics-eyebrow">WebGPU device baseline</p>
          <h1>设备与性能基线</h1>
          <p>采集当前 Electron 设备的图形能力和基础帧耗时，结果仅保存在当前页面。</p>
        </div>
        <Button variant="secondary" size="compact" disabled={running} onClick={() => void runDiagnostics()}>
          {running ? '测试中' : '重新测试'}
        </Button>
      </header>

      {error && <p className="webgpu-diagnostics-error" data-testid="webgpu-diagnostics-error">{error}</p>}
      {snapshot && (
        <pre className="webgpu-diagnostics-output" data-testid="webgpu-diagnostics-output">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      )}
    </main>
  )
}
