import { useEffect, useState } from 'react'
import { Activity, CircleDot, Clock3, Database, PlugZap, Radio, RefreshCw, Square, Video } from 'lucide-react'

import type { CameraBridgeStatus } from '../shared/types'
import { Button } from '../ui'
import { CameraBridgePreview } from '../components/CameraBridgePreview'
import '../styles/camera-bridge.css'

type BridgeStats = {
  source: string
  codec: string
  resolution: string
  frames: number
  bytes: string
  fps: string
  keyframes: number
}

const EMPTY_STATS: BridgeStats = {
  source: '—',
  codec: '—',
  resolution: '—',
  frames: 0,
  bytes: '0 B',
  fps: '0',
  keyframes: 0,
}

function connectionLabel(state: CameraBridgeStatus['state']): string {
  if (state === 'receiving') return '正在接收'
  if (state === 'connected') return 'USB 已连接'
  if (state === 'negotiating') return '正在握手'
  if (state === 'waiting-usb') return '等待 USB'
  if (state === 'error') return 'USB 错误'
  return '未监听'
}

function formatCheckedAt(date: Date | null): string {
  if (!date) return '尚未检查'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function CameraBridgePage() {
  const [connectionState, setConnectionState] = useState<CameraBridgeStatus['state']>('idle')
  const [stats, setStats] = useState<BridgeStats>(EMPTY_STATS)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [status, setStatus] = useState<CameraBridgeStatus | null>(null)

  useEffect(() => {
    const unsubscribe = window.luna.cameraBridge.onStatus((next) => {
      setStatus(next)
      setConnectionState(next.state)
      setCheckedAt(new Date())
      setStats({
        source: 'Android 手机',
        codec: next.codec,
        resolution: next.width && next.height ? `${next.width}×${next.height}` : '—',
        frames: next.videoFrames,
        bytes: formatBytes(next.bytes),
        fps: next.fps.toFixed(1),
        keyframes: next.keyframes,
      })
    })
    void window.luna.cameraBridge.start()
    return () => {
      unsubscribe()
      void window.luna.cameraBridge.stop()
    }
  }, [])

  function refreshStatus(): void {
    void window.luna.cameraBridge.start()
  }

  function toggleListening(): void {
    if (connectionState === 'idle') void window.luna.cameraBridge.start()
    else void window.luna.cameraBridge.stop()
  }

  const receiving = connectionState === 'receiving'
  const listening = connectionState !== 'idle'

  return (
    <main className="camera-bridge-page">
      <header className="camera-bridge-header">
        <div>
          <div className="camera-bridge-eyebrow">CAMERA BRIDGE</div>
          <h1>视频流测试</h1>
          <p>Android 手机输入源 · AOA USB 接收状态</p>
        </div>
        <div className="camera-bridge-header-actions">
          <Button icon={listening ? <Square size={14} /> : <PlugZap size={15} />} onClick={toggleListening} size="compact" variant={listening ? 'secondary' : 'primary'}>
            {listening ? '停止监听' : '开始监听'}
          </Button>
          <Button icon={<RefreshCw size={15} />} onClick={refreshStatus} size="compact" variant="secondary">重新连接</Button>
        </div>
      </header>

      <section className="camera-bridge-layout">
        <div className="camera-bridge-preview-panel">
          <div className="camera-bridge-preview">
            <CameraBridgePreview receiving={receiving} transportError={status?.error ?? null} />
            <div className="camera-bridge-preview-meta">
              <span className={receiving ? 'bridge-live-dot active' : 'bridge-live-dot'} />
              <span>{connectionLabel(connectionState)}</span>
              <span className="camera-bridge-preview-format">{stats.resolution} · {stats.codec} · AOA USB</span>
            </div>
          </div>

          <div className="camera-bridge-stats-grid">
            <StatCard icon={<Radio size={15} />} label="输入源" value={stats.source} />
            <StatCard icon={<Video size={15} />} label="编码格式" value={stats.codec} />
            <StatCard icon={<Activity size={15} />} label="接收帧" value={String(stats.frames)} />
            <StatCard icon={<Database size={15} />} label="接收数据" value={stats.bytes} />
            <StatCard icon={<Activity size={15} />} label="当前 FPS" value={stats.fps} />
            <StatCard icon={<CircleDot size={15} />} label="关键帧" value={String(stats.keyframes)} />
          </div>
        </div>

        <aside className="camera-bridge-side">
          <section className="camera-bridge-card">
            <div className="camera-bridge-card-heading">
              <div>
                <span className="camera-bridge-card-kicker">RECEIVER</span>
                <h2>接收状态</h2>
              </div>
              <span className={`camera-bridge-status-pill ${connectionState}`}>
                <span className="bridge-live-dot" />
                {connectionLabel(connectionState)}
              </span>
            </div>
            <dl className="camera-bridge-details">
              <div><dt>通道</dt><dd>Android AOA USB</dd></div>
              <div><dt>协议</dt><dd>LBRG · CRC32</dd></div>
              <div><dt>最近检查</dt><dd>{formatCheckedAt(checkedAt)}</dd></div>
            </dl>
          </section>

          <section className="camera-bridge-card">
            <div className="camera-bridge-card-heading">
              <div>
                <span className="camera-bridge-card-kicker">INPUT SOURCES</span>
                <h2>输入源</h2>
              </div>
            </div>
            <div className="camera-bridge-source-list">
              <SourceRow title="手机摄像头" detail="Android Camera2 · H.264" state={receiving ? '正在发送' : '等待 USB'} active />
              <SourceRow title="Luna Ultra" detail="Wi-Fi 视频输入" state="待验证" />
              <SourceRow title="外接设备" detail="USB / 网络摄像头" state="待接入" />
            </div>
          </section>

          <section className="camera-bridge-card camera-bridge-note">
            <Clock3 size={16} />
            <span>{status?.error ?? (receiving ? '已收到 H.264 编码帧，虚拟摄像头输出尚未接入。' : '页面会持续监听 Android AOA USB 设备。')}</span>
          </section>
        </aside>
      </section>
    </main>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="camera-bridge-stat">
      <div className="camera-bridge-stat-label">{icon}<span>{label}</span></div>
      <strong>{value}</strong>
    </div>
  )
}

function SourceRow({ active = false, detail, state, title }: { active?: boolean; detail: string; state: string; title: string }) {
  return (
    <div className={`camera-bridge-source-row ${active ? 'active' : ''}`}>
      <span className="camera-bridge-source-dot" />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <em>{state}</em>
    </div>
  )
}
