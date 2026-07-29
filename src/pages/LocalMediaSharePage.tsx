import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clipboard, QrCode, RefreshCw, ShieldCheck, Smartphone, Square, Wifi } from 'lucide-react'

import type { LocalMediaShareNetwork, LocalMediaShareSource, LocalMediaShareStatus } from '../shared/types'
import { Button, LoadingIndicator, Select, Switch, toast } from '../ui'
import '../styles/local-media-share.css'

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

export function LocalMediaSharePage() {
  const [networks, setNetworks] = useState<LocalMediaShareNetwork[]>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [shareLocal, setShareLocal] = useState(true)
  const [shareExports, setShareExports] = useState(true)
  const [status, setStatus] = useState<LocalMediaShareStatus>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'start' | 'stop' | null>(null)

  const refresh = useCallback(async () => {
    const [nextNetworks, nextStatus] = await Promise.all([
      window.luna.localMediaShare.listNetworks(),
      window.luna.localMediaShare.getStatus(),
    ])
    setNetworks(nextNetworks)
    setStatus(nextStatus)
    setSelectedAddress((current) => {
      if (nextStatus.address && nextNetworks.some((network) => network.address === nextStatus.address)) return nextStatus.address
      if (nextNetworks.some((network) => network.address === current)) return current
      return nextNetworks[0]?.address ?? ''
    })
  }, [])

  useEffect(() => {
    let active = true
    void refresh()
      .catch(() => {
        if (active) toast.error('无法读取当前网络，请稍后重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const timer = window.setInterval(() => {
      void window.luna.localMediaShare.getStatus().then((nextStatus) => {
        if (active) setStatus(nextStatus)
      }).catch(() => undefined)
    }, 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh])

  const selectedSources = useMemo(() => {
    const sources: LocalMediaShareSource[] = []
    if (shareLocal) sources.push('local')
    if (shareExports) sources.push('export')
    return sources
  }, [shareExports, shareLocal])

  async function startSharing(): Promise<void> {
    if (!selectedAddress || selectedSources.length === 0) return
    setAction('start')
    try {
      setStatus(await window.luna.localMediaShare.start({ address: selectedAddress, sources: selectedSources }))
      toast.success('手机访问已开启')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动失败，请检查当前网络')
    } finally {
      setAction(null)
    }
  }

  async function stopSharing(): Promise<void> {
    setAction('stop')
    try {
      setStatus(await window.luna.localMediaShare.stop())
      toast.success('手机访问已停止')
    } catch {
      toast.error('停止失败，请重试')
    } finally {
      setAction(null)
    }
  }

  async function copyAddress(): Promise<void> {
    if (!status.url) return
    try {
      await navigator.clipboard.writeText(status.url)
      toast.success('访问地址已复制')
    } catch {
      toast.error('无法复制，请使用手机扫描二维码')
    }
  }

  if (loading) {
    return <section className="local-share-page"><LoadingIndicator label="正在读取网络" /></section>
  }

  const totalCount = status.localCount + status.exportCount

  return (
    <section className="local-share-page">
      <div className="local-share-layout">
        <header className="local-share-header">
          <div className="local-share-title-icon"><Smartphone size={23} /></div>
          <div>
            <h1>手机访问</h1>
            <p>同一局域网内扫码浏览和下载电脑中的资源</p>
          </div>
        </header>

        <div className="local-share-columns">
          <section className="local-share-control" aria-label="分享设置">
            <div className="local-share-section-title"><ShieldCheck size={16} />分享范围</div>
            <div className="local-share-option-list">
              <label className="local-share-option">
                <span><strong>本地素材</strong><small>已经下载到本地资源目录的文件</small></span>
                <Switch checked={shareLocal} onCheckedChange={setShareLocal} ariaLabel="分享本地素材" disabled={status.running || action !== null} />
              </label>
              <label className="local-share-option">
                <span><strong>导出文件</strong><small>导出记录中已完成且仍然存在的文件</small></span>
                <Switch checked={shareExports} onCheckedChange={setShareExports} ariaLabel="分享导出文件" disabled={status.running || action !== null} />
              </label>
            </div>

            <div className="local-share-network">
              <div className="local-share-section-title"><Wifi size={16} />当前网络</div>
              {networks.length > 0 ? (
                <Select
                  variant="compact"
                  value={selectedAddress}
                  onValueChange={setSelectedAddress}
                  options={networks.map((network) => ({ value: network.address, label: `${network.name} · ${network.address}` }))}
                  fullWidth
                  disabled={status.running || action !== null}
                  placeholder="选择局域网"
                />
              ) : (
                <div className="local-share-notice">没有找到可用的局域网，请先连接 Wi-Fi 或有线网络。</div>
              )}
            </div>

            <div className="local-share-security-note">
              拿到二维码的人可以访问本次分享内容。请只在信任的局域网中开启，使用完成后及时停止。
            </div>

            {!status.running ? (
              <Button
                variant="primary"
                icon={<QrCode size={16} />}
                disabled={!selectedAddress || selectedSources.length === 0 || action !== null}
                onClick={() => void startSharing()}
              >
                {action === 'start' ? '正在启动...' : '启动分享'}
              </Button>
            ) : (
              <Button variant="danger" icon={<Square size={15} />} disabled={action !== null} onClick={() => void stopSharing()}>
                {action === 'stop' ? '正在停止...' : '停止分享'}
              </Button>
            )}
          </section>

          <section className="local-share-access" aria-live="polite">
            {status.running && status.qrDataUrl ? (
              <>
                <div className="local-share-running"><span />分享中</div>
                <img className="local-share-qr" src={status.qrDataUrl} alt="手机访问二维码" />
                <strong className="local-share-scan-title">使用手机扫描二维码</strong>
                <p className="local-share-count">{totalCount} 个资源 · 本地素材 {status.localCount} · 导出文件 {status.exportCount}</p>
                <button className="local-share-address" onClick={() => void copyAddress()} title="复制访问地址">
                  <span>{status.url}</span><Clipboard size={15} />
                </button>
              </>
            ) : (
              <div className="local-share-idle">
                <div className="local-share-idle-icon"><QrCode size={36} /></div>
                <strong>二维码将在这里显示</strong>
                <p>启动后，手机无需安装应用即可打开资源列表。</p>
                <Button variant="secondary" size="compact" icon={<RefreshCw size={14} />} onClick={() => void refresh()}>
                  刷新网络
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
