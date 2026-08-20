import { useState } from 'react'
import { Activity, CircleDot, Clock3, Database, Radio, RefreshCw, Video } from 'lucide-react'

import { Button } from '../ui'
import '../styles/camera-bridge.css'

type BridgeConnectionState = 'idle' | 'waiting' | 'receiving'

interface BridgeStats {
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

function connectionLabel(state: BridgeConnectionState): string {
  if (state === 'receiving') return '正在接收'
  if (state === 'waiting') return '等待连接'
  return '未连接'
}

function formatCheckedAt(date: Date | null): string {
  if (!date) return '尚未检查'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function CameraBridgePage() {
  const [connectionState, setConnectionState] = useState<BridgeConnectionState>('idle')
  const [stats, setStats] = useState<BridgeStats>(EMPTY_STATS)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  function refreshStatus(): void {
    setCheckedAt(new Date())
    setConnectionState('waiting')
    setStats(EMPTY_STATS)
  }

  const receiving = connectionState === 'receiving'

  return (
    <main className="camera-bridge-page">
      <header className="camera-bridge-header">
        <div>
          <div className="camera-bridge-eyebrow">CAMERA BRIDGE</div>
          <h1>视频流测试</h1>
          <p>Android 输入源 · 桌面接收状态</p>
        </div>
        <Button
          icon={<RefreshCw size={15} />}
          onClick={refreshStatus}
          size="compact"
          variant="secondary"
        >
          刷新状态
        </Button>
      </header>

      <section className="camera-bridge-layout">
        <div className="camera-bridge-preview-panel">
          <div className="camera-bridge-preview">
            <div className="camera-bridge-preview-empty">
              <Video size={36} strokeWidth={1.5} />
              <strong>{receiving ? '正在接收视频流' : '等待视频流'}</strong>
              <span>{connectionState === 'waiting' ? '接收通道已准备' : '接收器待接入'}</span>
            </div>
            <div className="camera-bridge-preview-meta">
              <span className={receiving ? 'bridge-live-dot active' : 'bridge-live-dot'} />
              <span>{connectionLabel(connectionState)}</span>
              <span className="camera-bridge-preview-format">{stats.resolution} · {stats.codec}</span>
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
              <div><dt>通道</dt><dd>Android Bridge</dd></div>
              <div><dt>协议</dt><dd>LBRG · 待接入</dd></div>
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
              <SourceRow title="手机摄像头" detail="Android Camera2 · H.264" state="已编码" active />
              <SourceRow title="Luna Ultra" detail="Wi-Fi 视频输入" state="待验证" />
              <SourceRow title="外接设备" detail="USB / 网络摄像头" state="待接入" />
            </div>
          </section>

          <section className="camera-bridge-card camera-bridge-note">
            <Clock3 size={16} />
            <span>页面已就绪，当前桌面接收器尚未接入。</span>
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
