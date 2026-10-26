import { Button, toast } from '../ui'
import type { LiveConnectionDiagnostic, LiveStreamStatus } from '../shared/types'
import { liveErrorMessage } from '../shared/liveConnectionDiagnostics'
import { AppleDriverDownloadButton } from './AppleDriverDownloadButton'
import { AppleServiceStartButton } from './AppleServiceStartButton'
import './LiveConnectionDiagnostics.css'

export function LiveConnectionDiagnostics({ status, errors, onChanged }: {
  status: LiveStreamStatus
  errors: (string | null | undefined)[]
  onChanged: () => void
}) {
  const diagnostics: LiveConnectionDiagnostic[] = [...(status.connectionDiagnostics ?? [])]
  const controlError = status.lastControlResult?.ok === false ? status.lastControlResult.error : null
  for (const detail of [...errors, controlError]) {
    if (detail && !diagnostics.some((item) => item.detail === detail || item.message === detail)) {
      diagnostics.push({ source: '直播', message: liveErrorMessage(detail), detail })
    }
  }
  if (!diagnostics.length) return null
  const text = diagnostics.map((item) => `[${item.source}] ${item.message}\n${item.detail}`).join('\n\n')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败')
    }
  }
  return <section className="live-connection-diagnostics" aria-label="连接提示">
    <div className="live-connection-diagnostics-header">
      <strong>连接提示</strong>
      <Button variant="ghost" size="mini" onClick={() => void copy()}>复制错误</Button>
    </div>
    {diagnostics.map((item, index) => <div className="live-connection-diagnostic" key={`${item.source}-${index}`}>
      <p role="status">{item.source}：{item.message}</p>
      {item.action === 'install-apple-driver' && <AppleDriverDownloadButton status={status.appleDriverDownload} />}
      {item.action === 'start-apple-service' && <AppleServiceStartButton onChanged={onChanged} />}
      <pre aria-label={`${item.source}错误详情`}>{item.detail}</pre>
    </div>)}
  </section>
}
