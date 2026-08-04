import { Button } from '../ui'
import type { RenderInitFailure } from '../shared/lrcErrorDiagnostics'
import './LrcRenderError.css'

interface LrcRenderErrorProps {
  className?: string
  failure: RenderInitFailure
  retrying: boolean
  onRetry: () => void
}

export function LrcRenderError({ className, failure, retrying, onRetry }: LrcRenderErrorProps) {
  return (
    <div className={[className, 'lrc-render-error'].filter(Boolean).join(' ')}>
      <p>{failure.summary}</p>
      <div className="lrc-render-error-details">
        <strong>错误详情</strong>
        <pre>{failure.detail}</pre>
      </div>
      <Button variant="secondary" disabled={retrying} onClick={onRetry}>
        {retrying ? '正在检测...' : failure.retryLabel}
      </Button>
    </div>
  )
}
