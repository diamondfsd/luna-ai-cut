import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Radio, Square } from 'lucide-react'

import { Button, IconButton, Input, Tooltip, toast } from '../ui'
import type { LiveStreamReplayStatus } from '../shared/types'
import '../styles/live-stream-replay-control.css'

interface LiveStreamReplayControlProps {
  captureActive: boolean
  enhanceQuality: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function LiveStreamReplayControl({ captureActive, enhanceQuality }: LiveStreamReplayControlProps) {
  const [status, setStatus] = useState<LiveStreamReplayStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'url' | 'log' | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.luna.liveStream.replayStatus())
    } catch {
      // The main process can be shutting down while this panel is still mounted.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      setStatus(await window.luna.liveStream.startReplay({ enhanceQuality }))
      toast.success('模拟推流已启动')
    } catch {
      toast.error('无法启动模拟推流')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (busy) return
    setBusy(true)
    try {
      setStatus(await window.luna.liveStream.stopReplay())
      toast.success('模拟推流已停止')
    } catch {
      toast.error('无法停止模拟推流')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value: string, target: 'url' | 'log') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(target)
      window.setTimeout(() => setCopied(null), 1_500)
      toast.success(target === 'url' ? '地址已复制' : '日志路径已复制')
    } catch {
      toast.error(target === 'url' ? '无法复制地址' : '无法复制日志路径')
    }
  }

  const running = status?.state === 'running' || status?.state === 'starting'
  const stateLabel = status?.state === 'running'
    ? '推流中'
    : status?.state === 'starting'
      ? '启动中'
      : status?.state === 'stopping'
        ? '正在停止'
        : status?.state === 'error'
          ? '推流失败'
          : status?.state === 'stopped'
            ? '已停止'
            : '未启动'

  return (
    <div className="live-replay-control">
      <div className="live-replay-heading">
        <strong>采集样本回放</strong>
        <span className={running ? 'active' : undefined} role="status">{stateLabel}</span>
      </div>
      {running ? (
        <Button variant="danger" size="compact" icon={<Square size={14} />} onClick={() => void stop()} disabled={busy}>
          {busy ? '处理中...' : '停止模拟'}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="compact"
          icon={<Radio size={14} />}
          onClick={() => void start()}
          disabled={busy || captureActive || !status?.capturePath}
        >
          {busy ? '处理中...' : '模拟推流'}
        </Button>
      )}

      <label className="live-replay-field">
        <span>采集样本</span>
        <Input variant="compact" fullWidth readOnly value={status?.capturePath ?? ''} aria-label="回放样本路径" placeholder="无可用样本" />
      </label>
      <div className="live-replay-path-row">
        <Input variant="compact" fullWidth readOnly value={status?.pullUrl ?? ''} aria-label="模拟推流地址" placeholder="启动后生成拉流地址" />
        <Tooltip content={copied === 'url' ? '已复制' : '复制地址'}>
          <IconButton
            variant="outline"
            size="compact"
            icon={copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
            aria-label="复制模拟推流地址"
            title="复制模拟推流地址"
            onClick={() => status?.pullUrl && void copy(status.pullUrl, 'url')}
            disabled={!status?.pullUrl}
          />
        </Tooltip>
      </div>

      {status && (running || status.videoFrames > 0) && (
        <div className="live-replay-metrics" aria-label="模拟推流诊断">
          <span>视频 {status.videoFrames} 帧</span>
          <span>音频 {status.audioFrames} 帧</span>
          <span>输出 {formatBytes(status.outputBytes)}</span>
          <span>拉流端 {status.activeClients}</span>
          <span>未连接丢弃 {formatBytes(status.droppedBytesNoClient)}</span>
          <span>读取过慢丢弃 {formatBytes(status.droppedBytesBackpressure)}</span>
          <span>最大回放落后 {status.maxPlaybackLagMs.toFixed(0)} ms</span>
        </div>
      )}

      {status?.diagnosticsLogPath && (
        <div className="live-replay-path-row">
          <Input variant="compact" fullWidth readOnly value={status.diagnosticsLogPath} aria-label="模拟推流日志路径" />
          <Tooltip content={copied === 'log' ? '已复制' : '复制日志路径'}>
            <IconButton
              variant="outline"
              size="compact"
              icon={copied === 'log' ? <Check size={14} /> : <Copy size={14} />}
              aria-label="复制模拟推流日志路径"
              title="复制模拟推流日志路径"
              onClick={() => void copy(status.diagnosticsLogPath!, 'log')}
            />
          </Tooltip>
        </div>
      )}
      {status?.state === 'error' && <span className="live-replay-error" role="alert">模拟推流失败，查看诊断日志</span>}
    </div>
  )
}
