import { useEffect, useState } from 'react'
import { Loader2, PlugZap, Radio, RefreshCcw, Search, Wifi } from 'lucide-react'

import type { DeviceDefinition, WifiDebugNetwork, WifiDebugResult, WifiDebugStatus } from '../shared/types'
import { Button, Input, Switch } from '../ui'

interface WifiTabProps {
  activeDevice?: DeviceDefinition
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function WifiTab({ activeDevice }: WifiTabProps) {
  const [wifiStatus, setWifiStatus] = useState<WifiDebugStatus | null>(null)
  const [wifiNetworks, setWifiNetworks] = useState<WifiDebugNetwork[]>([])
  const [wifiLoading, setWifiLoading] = useState(false)
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')
  const [wifiBssid, setWifiBssid] = useState('')
  const [wifiHidden, setWifiHidden] = useState(false)
  const [wifiTimeoutMs, setWifiTimeoutMs] = useState(15000)
  const [deviceHost, setDeviceHost] = useState(activeDevice?.defaultHost ?? '192.168.42.1')
  const [devicePort, setDevicePort] = useState(activeDevice?.httpPort ?? 80)
  const [devicePath, setDevicePath] = useState('/')
  const [wifiCheckResult, setWifiCheckResult] = useState<string>('')
  const [wifiLogs, setWifiLogs] = useState<string[]>([])

  useEffect(() => {
    setDeviceHost(activeDevice?.defaultHost ?? '192.168.42.1')
    setDevicePort(activeDevice?.httpPort ?? 80)
  }, [activeDevice])

  function appendWifiLog(line: string): void {
    setWifiLogs((current) => [`${new Date().toLocaleTimeString()} ${line}`, ...current].slice(0, 100))
  }

  function recordWifiResult<T>(result: WifiDebugResult<T>, fallback: string): T | undefined {
    appendWifiLog(result.success ? result.message || fallback : `${result.code ?? 'ERROR'}：${result.message}`)
    if (!result.success) setWifiCheckResult(JSON.stringify(result, null, 2))
    return result.data
  }

  async function refreshWifiStatus(): Promise<void> {
    setWifiLoading(true)
    try {
      const result = await window.wifiDebug.getStatus()
      const nextStatus = recordWifiResult(result, 'Wi-Fi 状态已刷新')
      if (nextStatus) setWifiStatus(nextStatus)
    } finally {
      setWifiLoading(false)
    }
  }

  async function scanWifi(): Promise<void> {
    setWifiLoading(true)
    try {
      const result = await window.wifiDebug.scan()
      const networks = recordWifiResult(result, 'Wi-Fi 扫描完成')
      if (networks) setWifiNetworks(networks)
    } finally {
      setWifiLoading(false)
    }
  }

  async function connectWifi(): Promise<void> {
    setWifiLoading(true)
    try {
      const result = await window.wifiDebug.connect({
        ssid: wifiSsid,
        password: wifiPassword,
        bssid: wifiBssid,
        hidden: wifiHidden,
        timeoutMs: wifiTimeoutMs,
      })
      const nextStatus = recordWifiResult(result, `已尝试连接 ${wifiSsid}`)
      if (nextStatus) setWifiStatus(nextStatus)
      if (result.success) {
        appendWifiLog('连接请求已发送，正在刷新当前状态')
        await sleep(1000)
        const statusResult = await window.wifiDebug.getStatus()
        const refreshedStatus = recordWifiResult(statusResult, 'Wi-Fi 状态已刷新')
        if (refreshedStatus) {
          setWifiStatus(refreshedStatus)
          appendWifiLog(refreshedStatus.ssid === wifiSsid ? `已连接到 ${wifiSsid}` : `连接请求完成，当前 Wi-Fi 是 ${refreshedStatus.ssid ?? '未知'}`)
        }
      }
    } finally {
      setWifiLoading(false)
    }
  }

  async function disconnectWifi(): Promise<void> {
    setWifiLoading(true)
    try {
      const result = await window.wifiDebug.disconnect()
      const nextStatus = recordWifiResult(result, '已尝试断开 Wi-Fi')
      if (nextStatus) setWifiStatus(nextStatus)
    } finally {
      setWifiLoading(false)
    }
  }

  async function checkDevicePort(): Promise<void> {
    setWifiLoading(true)
    try {
      const result = await window.wifiDebug.checkPort({ host: deviceHost, port: devicePort, timeoutMs: wifiTimeoutMs })
      const data = recordWifiResult(result, 'TCP 端口检查完成')
      setWifiCheckResult(JSON.stringify(result.success ? data : result, null, 2))
    } finally {
      setWifiLoading(false)
    }
  }

  async function requestDeviceHttp(): Promise<void> {
    setWifiLoading(true)
    try {
      const result = await window.wifiDebug.httpRequest({ host: deviceHost, port: devicePort, path: devicePath, timeoutMs: wifiTimeoutMs })
      const data = recordWifiResult(result, 'HTTP 请求完成')
      setWifiCheckResult(JSON.stringify(result.success ? data : result, null, 2))
    } finally {
      setWifiLoading(false)
    }
  }

  return (
    <div className="ble-debug-grid wifi-debug-grid">
      <section className="ble-debug-panel wifi-status-panel">
        <h2><Wifi size={17} /> 当前状态</h2>
        <div className="wifi-status-grid">
          <span>平台</span><strong>{wifiStatus?.platform ?? '-'}</strong>
          <span>接口</span><strong>{wifiStatus?.interfaceName ?? '-'}</strong>
          <span>SSID</span><strong>{wifiStatus?.ssid ?? '-'}</strong>
          <span>BSSID</span><strong>{wifiStatus?.bssid ?? '-'}</strong>
          <span>信号</span><strong>{wifiStatus?.signal ?? '-'}</strong>
          <span>IP</span><strong>{wifiStatus?.ipAddress ?? '-'}</strong>
        </div>
        <div className="ble-actions">
          <Button variant="primary" onClick={refreshWifiStatus} disabled={wifiLoading} icon={wifiLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}>
            刷新状态
          </Button>
          <Button variant="secondary" onClick={scanWifi} disabled={wifiLoading} icon={<Search size={16} />}>
            扫描 Wi-Fi
          </Button>
        </div>
      </section>

      <section className="ble-debug-panel wifi-connect-panel">
        <h2><PlugZap size={17} /> 连接</h2>
        <label>
          <span>SSID</span>
          <Input variant="compact" fullWidth value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} />
        </label>
        <label>
          <span>密码</span>
          <Input variant="compact" fullWidth type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} />
        </label>
        <label>
          <span>BSSID（可选）</span>
          <Input variant="compact" fullWidth value={wifiBssid} onChange={(event) => setWifiBssid(event.target.value)} />
        </label>
        <div className="wifi-inline-row">
          <span>隐藏网络</span>
          <Switch checked={wifiHidden} onCheckedChange={setWifiHidden} ariaLabel="隐藏网络" />
        </div>
        <label>
          <span>超时（ms）</span>
          <Input variant="compact" fullWidth type="number" min={1000} value={wifiTimeoutMs} onChange={(event) => setWifiTimeoutMs(Number(event.target.value) || 15000)} />
        </label>
        <div className="ble-actions">
          <Button variant="primary" onClick={connectWifi} disabled={wifiLoading || !wifiSsid.trim()}>连接</Button>
          <Button variant="secondary" onClick={disconnectWifi} disabled={wifiLoading}>断开</Button>
        </div>
      </section>

      <section className="ble-debug-panel wifi-device-panel">
        <h2><Radio size={17} /> 设备检查</h2>
        <label>
          <span>IP</span>
          <Input variant="compact" fullWidth value={deviceHost} onChange={(event) => setDeviceHost(event.target.value)} />
        </label>
        <label>
          <span>端口</span>
          <Input variant="compact" fullWidth type="number" min={1} max={65535} value={devicePort} onChange={(event) => setDevicePort(Number(event.target.value) || 80)} />
        </label>
        <label>
          <span>路径</span>
          <Input variant="compact" fullWidth value={devicePath} onChange={(event) => setDevicePath(event.target.value)} />
        </label>
        <div className="ble-actions">
          <Button variant="primary" onClick={checkDevicePort} disabled={wifiLoading}>检查 TCP</Button>
          <Button variant="secondary" onClick={requestDeviceHttp} disabled={wifiLoading}>HTTP 请求</Button>
        </div>
        {wifiCheckResult && <pre className="wifi-result-json">{wifiCheckResult}</pre>}
      </section>

      <section className="ble-debug-panel wifi-network-panel">
        <h2><Search size={17} /> Wi-Fi 列表</h2>
        <div className="wifi-network-table">
          <div className="wifi-network-head">
            <span>SSID</span>
            <span>信号</span>
            <span>安全</span>
            <span>BSSID</span>
            <span>操作</span>
          </div>
          {wifiNetworks.length === 0 && <p>扫描后 Wi-Fi 会显示在这里。</p>}
          {wifiNetworks.map((network, index) => (
            <div className="wifi-network-row" key={`${network.ssid}-${network.bssid ?? index}`}>
              <strong>{network.ssid}</strong>
              <span>{network.signal ?? '-'}</span>
              <span>{network.security ?? '-'}</span>
              <span>{network.bssid ?? '-'}</span>
              <Button
                variant="secondary"
                size="mini"
                onClick={() => {
                  setWifiSsid(network.ssid)
                  setWifiBssid(network.bssid ?? '')
                }}
              >
                填入
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="ble-debug-panel ble-debug-log">
        <h2>日志</h2>
        {wifiLogs.length === 0 && <p className="ble-empty-hint">暂无日志。</p>}
        {wifiLogs.map((line) => <code key={line}>{line}</code>)}
      </section>
    </div>
  )
}
