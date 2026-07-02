import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, FileText, Info, KeyRound, List, Play, Plug, RotateCcw, Wifi } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import type { DeviceDebugDiagnosticsResult, DeviceDebugFileListResult, DeviceDebugTestStep, Insta360DeviceInfo } from '../shared/types'
import { Button, Input, toast } from '../ui'
import '../styles/device-debug.css'

const DEVICE_ID = 'insta360-generic'
const DEFAULT_HOST = '192.168.42.1'
const CONTROL_PORT = 6666

interface LogEntry {
  id: number
  time: string
  level: 'info' | 'warn' | 'error' | 'data'
  message: string
  data?: unknown
}

type HttpProbe = NonNullable<DeviceDebugFileListResult['http']>[number]

const AUTH_STATE_LABELS: Record<string, string> = {
  none: '未连接',
  basic_auth_done: '控制通道可用',
  checking: '授权检查中',
  need_camera_confirm: '等待相机确认',
  authorized: '已授权',
  failed: '授权失败',
}

export function DeviceDebugPage() {
  const navigate = useNavigate()
  const [host, setHost] = useState(DEFAULT_HOST)
  const [authState, setAuthState] = useState<string>('none')
  const [httpOk, setHttpOk] = useState<boolean | null>(null)
  const [controlOk, setControlOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [files, setFiles] = useState<Array<{ name: string; size: number | null; url: string }>>([])
  const [httpResults, setHttpResults] = useState<HttpProbe[]>([])
  const [deviceInfo, setDeviceInfo] = useState<Insta360DeviceInfo | null>(null)
  const [diagnostics, setDiagnostics] = useState<DeviceDebugDiagnosticsResult | null>(null)
  const [testSteps, setTestSteps] = useState<DeviceDebugTestStep[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logPath, setLogPath] = useState<string>('')
  const logIdRef = useRef(0)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const debugStandalone = typeof __DEBUG_STANDALONE__ !== 'undefined' && __DEBUG_STANDALONE__
  const authText = AUTH_STATE_LABELS[authState] ?? authState
  const httpReachable = httpResults.filter((item) => item.ok).length

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: unknown) => {
    const now = new Date()
    const time = now.toLocaleTimeString('zh-CN', { hour12: false })
    setLogs((prev) => [...prev.slice(-500), { id: ++logIdRef.current, time, level, message, data }])
  }, [])

  const writeLogFile = useCallback((level: string, message: string, data?: unknown) => {
    window.deviceDebug.log({ level, message, data }).catch(() => {})
  }, [])

  useEffect(() => {
    window.deviceDebug.getLogPath().then(setLogPath).catch(() => {})
  }, [])

  useEffect(() => {
    return window.deviceDebug.onLog((event) => {
      const level = event.level.toLowerCase() as LogEntry['level']
      addLog(level === 'info' || level === 'warn' || level === 'error' || level === 'data' ? level : 'info', event.message, event.data)
    })
  }, [addLog])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  async function checkPort(): Promise<void> {
    setBusy('port')
    addLog('info', `端口检测 ${host}`)
    writeLogFile('INFO', `端口检测 ${host}`)
    try {
      const result = await window.deviceDebug.checkPort({ deviceId: DEVICE_ID, host })
      setHttpOk(result.httpOk)
      setControlOk(result.controlOk)
      addLog('info', result.message, result)
    } catch (error) {
      setHttpOk(false)
      setControlOk(false)
      addLog('error', `端口检测异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function fetchDeviceInfo(): Promise<void> {
    setBusy('info')
    setDiagnostics(null)
    addLog('info', '获取设备信息 / 协议概览')
    writeLogFile('INFO', '获取设备信息 / 协议概览')
    try {
      const result = await window.deviceDebug.runDiagnostics({ deviceId: DEVICE_ID, host })
      setDiagnostics(result)
      setDeviceInfo(result.deviceInfo)
      setAuthState(result.auth?.authorized ? 'authorized' : result.auth?.needsConfirm ? 'need_camera_confirm' : result.tcp.some((item) => item.ok) ? 'basic_auth_done' : 'none')
      setFiles(result.files.map((file) => ({ name: file.name, size: file.size, url: file.url })))
      setHttpResults(result.http)
      setHttpOk(result.http.some((item) => item.ok))
      setControlOk(result.tcp.some((item) => item.ok))
      addLog(result.success ? 'info' : 'warn', result.summary, {
        deviceInfo: result.deviceInfo,
        auth: result.auth,
        files: result.files.length,
        http: result.http.map((item) => ({ path: item.path, ok: item.ok, status: item.status, error: item.error })),
      })
    } catch (error) {
      addLog('error', `获取设备信息异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function checkAuth(): Promise<void> {
    setBusy('auth-check')
    addLog('info', '检查授权状态')
    writeLogFile('INFO', '检查授权状态')
    try {
      await window.deviceDebug.connect({ deviceId: DEVICE_ID, host })
      const result = await window.deviceDebug.checkAuth({ deviceId: DEVICE_ID, host })
      setAuthState(result.authState)
      setControlOk(true)
      addLog(result.success ? 'info' : 'warn', result.message)
    } catch (error) {
      setAuthState('failed')
      addLog('error', `授权检查异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function requestAuth(): Promise<void> {
    setBusy('auth-request')
    addLog('info', '请求授权，请在相机上确认')
    writeLogFile('INFO', '请求授权')
    try {
      await window.deviceDebug.connect({ deviceId: DEVICE_ID, host })
      const result = await window.deviceDebug.requestAuth({ deviceId: DEVICE_ID, host })
      setAuthState(result.authState)
      setControlOk(true)
      addLog(result.success ? 'info' : 'warn', result.message)
      toast.show(result.message, 4000)
    } catch (error) {
      setAuthState('failed')
      addLog('error', `授权请求异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function listFiles(): Promise<void> {
    setBusy('files')
    addLog('info', '读取 TCP 文件列表并验证 HTTP URL')
    writeLogFile('INFO', '读取 TCP 文件列表并验证 HTTP URL')
    try {
      const result = await window.deviceDebug.listFiles({ deviceId: DEVICE_ID, host })
      const http = result.http ?? []
      setFiles(result.files)
      setHttpResults(http)
      setHttpOk(http.some((item) => item.ok))
      setControlOk(result.success)
      addLog(result.success ? 'info' : 'warn', result.message, {
        files: result.files.length,
        httpReachable: http.filter((item) => item.ok).length,
        httpTotal: http.length,
      })
    } catch (error) {
      addLog('error', `读取文件列表异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy('disconnect')
    try {
      await window.deviceDebug.disconnect({ deviceId: DEVICE_ID, host })
      setAuthState('none')
      setHttpOk(null)
      setControlOk(null)
      addLog('info', '已断开调试会话')
    } catch (error) {
      addLog('error', `断开异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function runOneClickTest(): Promise<void> {
    setBusy('test')
    setTestSteps([])
    addLog('info', '一键测试开始')
    writeLogFile('INFO', '一键测试开始')
    try {
      const result = await window.deviceDebug.runTest({ deviceId: DEVICE_ID, host })
      setTestSteps(result.steps)
      setAuthState(result.authState)
      const passed = result.steps.filter((step) => step.success).length
      addLog(result.overall ? 'info' : 'warn', result.summary, {
        passed,
        total: result.steps.length,
        steps: result.steps,
      })
      toast.show(result.summary, 5000)
    } catch (error) {
      addLog('error', `一键测试异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  async function openLogFile(): Promise<void> {
    try {
      const filePath = await window.deviceDebug.getLogPath()
      await window.luna.openPath(filePath)
    } catch (error) {
      addLog('error', `打开日志文件失败: ${String(error)}`)
    }
  }

  function clearLogs(): void {
    setLogs([])
    setDiagnostics(null)
  }

  return (
    <div className="device-debug-surface">
      {!debugStandalone && (
        <div className="device-debug-topbar">
          <button className="device-debug-back" onClick={() => navigate(-1)} title="返回">
            <ArrowLeft size={18} />
          </button>
          <h1>Insta360 通用协议调试</h1>
          <span className="device-debug-badge">UCD2 TCP</span>
        </div>
      )}

      <div className="device-debug-grid">
        <div className="dd-panel">
          <h2><Plug size={16} /> 连接目标</h2>
          <label className="dd-field">
            <span>相机 IP</span>
            <Input value={host} onChange={(event) => setHost(event.target.value)} placeholder={DEFAULT_HOST} />
          </label>
          <div className="dd-status-grid">
            <span>控制端口</span>
            <strong>{CONTROL_PORT}</strong>
            <span>协议</span>
            <strong>Insta360 UCD2 TCP + MSG 授权</strong>
          </div>
          <div className="dd-actions">
            <Button onClick={runOneClickTest} size="compact" disabled={busy !== null}>
              <Play size={14} /> {busy === 'test' ? '测试中' : '一键测试'}
            </Button>
            <Button onClick={checkPort} size="compact" variant="secondary" disabled={busy !== null}>
              <Wifi size={14} /> {busy === 'port' ? '检测中' : '端口检测'}
            </Button>
            <Button onClick={fetchDeviceInfo} size="compact" disabled={busy !== null}>
              <Info size={14} /> {busy === 'info' ? '获取中' : '获取设备信息'}
            </Button>
            <Button onClick={disconnect} size="compact" variant="secondary" disabled={busy !== null}>
              <RotateCcw size={14} /> 断开
            </Button>
          </div>
          {logPath && <span className="dd-log-path">{logPath}</span>}
        </div>

        <div className="dd-panel">
          <h2><FileText size={16} /> 设备状态</h2>
          <div className="dd-status-grid">
            <span>HTTP 服务</span>
            <strong className={httpOk === true ? 'dd-ok' : httpOk === false ? 'dd-err' : ''}>{statusText(httpOk)}</strong>
            <span>控制通道</span>
            <strong className={controlOk === true ? 'dd-ok' : controlOk === false ? 'dd-err' : ''}>{statusText(controlOk)}</strong>
            <span>授权</span>
            <strong>{authText}</strong>
          </div>
          {deviceInfo ? (
            <div className="dd-diagnostics">
              {deviceInfo.deviceName && <span>设备：{deviceInfo.deviceName}</span>}
              {deviceInfo.serial && <span>序列号：{deviceInfo.serial}</span>}
              {deviceInfo.firmware && <span>固件：{deviceInfo.firmware}</span>}
              {deviceInfo.ssid && <span>SSID：{deviceInfo.ssid}</span>}
              {deviceInfo.wifiPassword && <span>Wi-Fi 密码：{deviceInfo.wifiPassword}</span>}
            </div>
          ) : (
            <p className="dd-hint">点击“获取设备信息”读取 GET_OPTIONS 返回的设备信息。</p>
          )}
          {diagnostics && <p className="dd-hint">{diagnostics.summary}</p>}
        </div>

        <div className="dd-panel">
          <h2><KeyRound size={16} /> 授权</h2>
          <div className="dd-actions">
            <Button onClick={checkAuth} size="compact" variant="secondary" disabled={busy !== null}>
              <KeyRound size={14} /> {busy === 'auth-check' ? '检查中' : '检查授权'}
            </Button>
            <Button onClick={requestAuth} size="compact" disabled={busy !== null}>
              <KeyRound size={14} /> {busy === 'auth-request' ? '等待中' : '请求授权'}
            </Button>
          </div>
          {authState === 'need_camera_confirm' && (
            <div className="dd-tip dd-tip-warn">请在相机屏幕上确认授权。</div>
          )}
          {authState === 'authorized' && (
            <div className="dd-tip dd-tip-ok">授权已完成，可以继续读取文件列表。</div>
          )}
        </div>

        {testSteps.length > 0 && (
          <div className="dd-panel dd-panel-full">
            <h2><Play size={16} /> 一键测试结果</h2>
            <div className="dd-test-steps">
              {testSteps.map((step) => (
                <div key={step.step} className="dd-test-step">
                  <strong className={step.success ? 'dd-ok' : 'dd-err'}>{step.success ? '通过' : '失败'}</strong>
                  <span>{step.step}</span>
                  <em>{step.detail}</em>
                  <small>{step.elapsedMs}ms</small>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="dd-panel dd-panel-wide">
          <h2><List size={16} /> 文件列表</h2>
          <div className="dd-actions">
            <Button onClick={listFiles} size="compact" disabled={busy !== null}>
              <List size={14} /> {busy === 'files' ? '读取中' : '读取 TCP 文件列表'}
            </Button>
          </div>
          <div className="dd-status-grid">
            <span>文件数量</span>
            <strong>{files.length}</strong>
            <span>HTTP 可达</span>
            <strong className={httpResults.length > 0 && httpReachable > 0 ? 'dd-ok' : httpResults.length > 0 ? 'dd-err' : ''}>
              {httpResults.length > 0 ? `${httpReachable}/${httpResults.length}` : '--'}
            </strong>
          </div>
          {files.length > 0 ? (
            <div className="dd-file-list">
              <div className="dd-file-head">
                <span>文件 URL</span>
                <span>大小</span>
              </div>
              {files.slice(0, 80).map((file, index) => (
                <div key={`${file.url}-${index}`} className="dd-file-item">
                  <strong title={file.url}>{file.url}</strong>
                  <span>{file.size != null ? formatBytes(file.size) : '--'}</span>
                </div>
              ))}
              {files.length > 80 && <p className="dd-file-more">...还有 {files.length - 80} 个</p>}
            </div>
          ) : (
            <p className="dd-hint">文件列表必须通过 TCP 命令获取；HTTP 只用于验证和下载。</p>
          )}
        </div>

        <div className="dd-panel">
          <h2><Wifi size={16} /> HTTP 验证</h2>
          {httpResults.length > 0 ? (
            <div className="dd-http-list">
              {httpResults.map((item, index) => (
                <div key={`${item.path}-${index}`} className="dd-http-item">
                  <strong className={item.ok ? 'dd-ok' : 'dd-err'}>{item.ok ? '可达' : '失败'}</strong>
                  <span title={item.path}>{item.path}</span>
                  <em>{item.status ?? item.error ?? '--'}</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="dd-hint">读取文件列表后，会对前几个文件 URL 发起 HTTP HEAD 验证。</p>
          )}
        </div>

        <div className="dd-panel dd-panel-full">
          <div className="dd-log-header">
            <h2><FileText size={16} /> 日志 {busy && <span className="dd-log-spinner" />}</h2>
            <div className="dd-actions">
              <Button onClick={openLogFile} size="compact" variant="secondary">
                <Download size={14} /> 日志文件
              </Button>
              <Button onClick={clearLogs} size="compact" variant="secondary">清空</Button>
            </div>
          </div>
          <div className="dd-log-content">
            {logs.length === 0 && <p className="dd-hint">暂无日志，点击上方操作即可看到输出。</p>}
            {logs.map((entry) => (
              <div key={entry.id} className={`dd-log-entry dd-log-${entry.level}`}>
                <span className="dd-log-time">{entry.time}</span>
                <span className="dd-log-msg">{entry.message}</span>
                {entry.data !== undefined ? <code className="dd-log-data">{JSON.stringify(entry.data)}</code> : null}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function statusText(value: boolean | null): string {
  if (value === true) return '可用'
  if (value === false) return '不可用'
  return '--'
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
