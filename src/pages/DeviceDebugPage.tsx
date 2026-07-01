import { useCallback, useEffect, useRef, useState } from 'react'
import { Plug, PlugZap, FileText, List, RotateCcw, Wifi, ArrowLeft, Play, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import type { DeviceDebugOption } from '../shared/types'
import { Button, Input, toast } from '../ui'
import '../styles/device-debug.css'

// ============================================================
// 类型
// ============================================================

interface LogEntry {
  id: number
  time: string
  level: 'info' | 'warn' | 'error' | 'data'
  message: string
  data?: unknown
}

// ============================================================
// DeviceDebugPage
// ============================================================

export function DeviceDebugPage() {
  const navigate = useNavigate()
  const [deviceOptions, setDeviceOptions] = useState<DeviceDebugOption[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [host, setHost] = useState('192.168.42.1')
  const [authState, setAuthState] = useState<string>('none')
  const [httpOk, setHttpOk] = useState<boolean | null>(null)
  const [controlOk, setControlOk] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [files, setFiles] = useState<Array<{ name: string; size: number | null; url: string }>>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logPath, setLogPath] = useState<string>('')
  const logIdRef = useRef(0)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const selectedDevice = deviceOptions.find((d) => d.id === selectedDeviceId)

  const AUTH_STATE_LABELS: Record<string, string> = {
    none: '未连接',
    basic_auth_done: '基础认证完成',
    checking: '授权检查中...',
    need_camera_confirm: '等待相机确认 ⚠️',
    authorized: '已授权 ✅',
    failed: '授权失败 ❌',
  }

  // 初始化：获取支持的设备列表、日志路径
  useEffect(() => {
    window.deviceDebug.getDeviceOptions().then((options) => {
      setDeviceOptions(options)
      if (options.length > 0) {
        setSelectedDeviceId(options[0].id)
        setHost(options[0].defaultHost)
      }
    }).catch(() => {})

    window.deviceDebug.getLogPath().then(setLogPath).catch(() => {})
  }, [])

  // 监听后端实时日志
  useEffect(() => {
    return window.deviceDebug.onLog((event) => {
      addLog(event.level as LogEntry['level'], event.message, event.data)
    })
  })

  // 自动滚动到底部
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // 切换设备类型时更新默认 IP
  useEffect(() => {
    const device = deviceOptions.find((d) => d.id === selectedDeviceId)
    if (device) setHost(device.defaultHost)
  }, [selectedDeviceId, deviceOptions])

  const addLog = useCallback((level: LogEntry['level'], message: string, data?: unknown) => {
    const now = new Date()
    const time = now.toLocaleTimeString('zh-CN', { hour12: false })
    setLogs((prev) => [...prev.slice(-500), { id: ++logIdRef.current, time, level, message, data }])
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
    setFiles([])
  }, [])

  /** 写入独立日志文件 */
  const writeLogFile = useCallback((level: string, message: string, data?: unknown) => {
    window.deviceDebug.log({ level, message, data }).catch(() => {})
  }, [])

  /** 端口检测 */
  async function checkPort(): Promise<void> {
    if (!selectedDeviceId) return
    addLog('info', `端口检测 ${host} ...`)
    writeLogFile('INFO', `端口检测 ${host}`)

    try {
      const result = await window.deviceDebug.checkPort({ deviceId: selectedDeviceId, host })
      setHttpOk(result.httpOk)
      setControlOk(result.controlOk)
      addLog('info', `HTTP: ${result.httpOk ? '✅' : '❌'} | 控制: ${result.controlOk ? '✅' : '❌'} | ${result.message}`)
      writeLogFile('INFO', `端口检测结果: HTTP=${result.httpOk}, 控制=${result.controlOk}, ${result.message}`)
    } catch (error) {
      setHttpOk(false)
      setControlOk(false)
      addLog('error', `端口检测异常: ${String(error)}`)
      writeLogFile('ERROR', `端口检测异常: ${String(error)}`)
    }
  }

  /** 连接设备 */
  async function connect(): Promise<void> {
    if (!selectedDeviceId || !selectedDevice) return
    setConnecting(true)
    addLog('info', `连接设备: ${selectedDevice.name} @ ${host}`)
    writeLogFile('INFO', `连接设备: ${selectedDeviceId} @ ${host}`)

    try {
      const result = await window.deviceDebug.connect({ deviceId: selectedDeviceId, host })
      setAuthState(result.authState)
      setHttpOk(result.httpOk)
      setControlOk(result.controlOk)
      addLog(result.success ? 'info' : 'warn', result.message)
      writeLogFile(result.success ? 'INFO' : 'WARN', `连接结果: ${result.message}`)
    } catch (error) {
      addLog('error', `连接异常: ${String(error)}`)
      writeLogFile('ERROR', `连接异常: ${String(error)}`)
    } finally {
      setConnecting(false)
    }
  }

  /** 断开设备 */
  async function disconnect(): Promise<void> {
    if (!selectedDeviceId) return
    addLog('info', '断开连接...')
    writeLogFile('INFO', '断开连接')
    try {
      await window.deviceDebug.disconnect({ deviceId: selectedDeviceId, host })
      setAuthState('none')
      setHttpOk(null)
      setControlOk(null)
      setFiles([])
      addLog('info', '已断开')
      writeLogFile('INFO', '已断开')
    } catch (error) {
      addLog('error', `断开异常: ${String(error)}`)
      writeLogFile('ERROR', `断开异常: ${String(error)}`)
    }
  }

  /** 检查授权 */
  async function checkAuth(): Promise<void> {
    if (!selectedDeviceId) return
    addLog('info', '检查授权状态...')
    writeLogFile('INFO', '检查授权状态')
    try {
      const result = await window.deviceDebug.checkAuth({ deviceId: selectedDeviceId, host })
      setAuthState(result.authState)
      addLog(result.success ? 'info' : 'warn', result.message)
      writeLogFile(result.success ? 'INFO' : 'WARN', `授权检查: ${result.message}`)
    } catch (error) {
      addLog('error', `授权检查异常: ${String(error)}`)
      writeLogFile('ERROR', `授权检查异常: ${String(error)}`)
    }
  }

  /** 请求授权 */
  async function requestAuth(): Promise<void> {
    if (!selectedDeviceId) return
    addLog('info', '发送授权请求，请在相机上确认...')
    writeLogFile('INFO', '发送授权请求')
    try {
      const result = await window.deviceDebug.requestAuth({ deviceId: selectedDeviceId, host })
      setAuthState(result.authState)
      addLog('info', result.message)
      writeLogFile('INFO', `授权请求: ${result.message}`)
    } catch (error) {
      addLog('error', `授权请求异常: ${String(error)}`)
      writeLogFile('ERROR', `授权请求异常: ${String(error)}`)
    }
  }

  /** 读取文件列表 */
  async function listFiles(): Promise<void> {
    if (!selectedDeviceId) return
    addLog('info', '读取文件列表...')
    writeLogFile('INFO', '读取文件列表')
    try {
      const result = await window.deviceDebug.listFiles({ deviceId: selectedDeviceId, host })
      if (result.success) {
        setFiles(result.files ?? [])
        addLog('info', `找到 ${(result.files ?? []).length} 个文件`)
        writeLogFile('INFO', `文件列表: ${(result.files ?? []).length} 个文件`)
      } else {
        addLog('error', result.message)
        writeLogFile('ERROR', `文件列表失败: ${result.message}`)
      }
    } catch (error) {
      addLog('error', `文件列表异常: ${String(error)}`)
      writeLogFile('ERROR', `文件列表异常: ${String(error)}`)
    }
  }

  /** 刷新连接状态 */
  async function checkConnectionStatus(): Promise<void> {
    if (!selectedDeviceId) return
    addLog('info', '检查连接状态...')
    try {
      const result = await window.deviceDebug.checkPort({ deviceId: selectedDeviceId, host })
      setHttpOk(result.httpOk)
      setControlOk(result.controlOk)
      addLog('info', `HTTP: ${result.httpOk ? '✅' : '❌'} | 控制: ${result.controlOk ? '✅' : '❌'} | ${result.message}`)
    } catch (error) {
      addLog('error', `状态检查异常: ${String(error)}`)
    }
  }

  // ============================================================
  // 一键测试
  // ============================================================

  async function runOneClickTest(): Promise<void> {
    if (!selectedDeviceId) return
    setTesting(true)
    setFiles([])
    addLog('info', '══════════ 一键测试启动 ══════════')
    writeLogFile('INFO', '══════ 一键测试启动 ══════')

    try {
      const result = await window.deviceDebug.runTest({
        deviceId: selectedDeviceId,
        host,
      })

      // 测试完成后更新 UI 状态
      setAuthState(result.authState)

      // 显示结果弹窗
      const passed = result.steps.filter((s) => s.success).length
      const total = result.steps.length
      const resultMsg = passed === total
        ? `✅ ${passed}/${total} 全部通过`
        : `⚠️ ${passed}/${total} 通过，请查看日志`

      addLog(result.overall ? 'info' : 'warn', `测试结束: ${resultMsg}`)
      writeLogFile(result.overall ? 'INFO' : 'WARN', `测试结束: ${resultMsg}`)

      toast.show(result.summary, 5000)
    } catch (error) {
      addLog('error', `一键测试异常: ${String(error)}`)
      writeLogFile('ERROR', `一键测试异常: ${String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  /** 打开日志文件 */
  async function openLogFile(): Promise<void> {
    try {
      const filePath = await window.deviceDebug.getLogPath()
      await window.luna.openPath(filePath)
    } catch (error) {
      addLog('error', `打开日志文件失败: ${String(error)}`)
    }
  }

  const needsAuth = selectedDevice?.needsAuth ?? false

  return (
    <div className="device-debug-surface">
      {/* 顶栏 */}
      <div className="device-debug-topbar">
        <button className="device-debug-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </button>
        <h1>设备协议调试</h1>
        <span className="device-debug-badge">开发模式</span>
      </div>

      {/* 主网格 */}
      <div className="device-debug-grid">
        {/* 左侧：设备配置 */}
        <div className="dd-panel">
          <h2><Plug size={16} /> 设备配置</h2>

          <label className="dd-field">
            <span>设备类型</span>
            <select
              className="dd-select"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
            >
              {deviceOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.name}</option>
              ))}
            </select>
          </label>

          <label className="dd-field">
            <span>相机 IP</span>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.42.1" />
          </label>

          <label className="dd-field">
            <span>控制端口</span>
            <Input value={String(selectedDevice?.controlPort ?? 6666)} readOnly />
          </label>

          <label className="dd-field">
            <span>协议</span>
            <Input value={selectedDevice?.protocolType ?? ''} readOnly />
          </label>

          <div className="dd-actions">
            <Button onClick={checkPort} size="compact" variant="secondary">
              <Wifi size={14} /> 端口检测
            </Button>
            <Button onClick={connect} size="compact" disabled={connecting}>
              <PlugZap size={14} /> 连接
            </Button>
            <Button onClick={disconnect} size="compact" variant="secondary">
              <RotateCcw size={14} /> 断开
            </Button>
          </div>

          {/* 一键测试 */}
          <div className="dd-section-divider" />
          <div className="dd-actions">
            <Button onClick={runOneClickTest} size="compact" disabled={testing} variant="primary" style={{ flex: 1 }}>
              <Play size={14} /> {testing ? '测试中...' : '一键测试'}
            </Button>
            <Button onClick={openLogFile} size="compact" variant="secondary" title="打开日志文件">
              <Download size={14} />
            </Button>
          </div>
          {logPath && <span className="dd-log-path">{logPath}</span>}
        </div>

        {/* 中间：状态 */}
        <div className="dd-panel">
          <h2><FileText size={16} /> 连接状态</h2>

          <div className="dd-status-grid">
            <span>协议状态</span>
            <strong>{AUTH_STATE_LABELS[authState] ?? authState}</strong>

            <span>HTTP 服务</span>
            <strong className={httpOk === true ? 'dd-ok' : httpOk === false ? 'dd-err' : ''}>
              {httpOk === true ? '✅ 可用' : httpOk === false ? '❌ 不可用' : '--'}
            </strong>

            <span>控制通道</span>
            <strong className={controlOk === true ? 'dd-ok' : controlOk === false ? 'dd-err' : ''}>
              {controlOk === true ? '✅ 可用' : controlOk === false ? '❌ 不可用' : '--'}
            </strong>
          </div>

          <div className="dd-actions">
            <Button onClick={checkConnectionStatus} size="compact" variant="secondary">
              <RotateCcw size={14} /> 刷新状态
            </Button>
            {needsAuth && (
              <>
                <Button onClick={checkAuth} size="compact" variant="secondary">
                  <FileText size={14} /> 检查授权
                </Button>
                <Button onClick={requestAuth} size="compact" variant="secondary">
                  <PlugZap size={14} /> 请求授权
                </Button>
              </>
            )}
          </div>

          {authState === 'need_camera_confirm' && (
            <div className="dd-tip dd-tip-warn">
              ⚠️ 请在 <strong>{selectedDevice?.name ?? '相机'}</strong> 屏幕上确认授权
            </div>
          )}

          {authState === 'authorized' && (
            <div className="dd-tip dd-tip-ok">
              ✅ 授权已完成，可以读取文件
            </div>
          )}
        </div>

        {/* 右侧：文件列表 */}
        <div className="dd-panel">
          <h2><List size={16} /> 文件列表</h2>

          <Button onClick={listFiles} size="compact" variant="secondary" disabled={authState === 'none'}>
            <List size={14} /> 读取文件
          </Button>

          {files.length > 0 && (
            <div className="dd-file-list">
              <div className="dd-file-head">
                <span>文件名</span>
                <span>大小</span>
              </div>
              {files.slice(0, 50).map((f, i) => (
                <div key={i} className="dd-file-item">
                  <strong>{f.name}</strong>
                  {f.size != null && <span>{formatBytes(f.size)}</span>}
                </div>
              ))}
              {files.length > 50 && (
                <p className="dd-file-more">...还有 {files.length - 50} 个</p>
              )}
            </div>
          )}

          {files.length === 0 && authState !== 'none' && (
            <p className="dd-hint">点击"读取文件"查看相机中的文件</p>
          )}
        </div>

        {/* 日志区：跨三列 */}
        <div className="dd-panel dd-panel-full">
          <div className="dd-log-header">
            <h2><FileText size={16} /> 日志 {testing && <span className="dd-log-spinner" />}</h2>
            <div className="dd-actions">
              <Button onClick={openLogFile} size="compact" variant="secondary">
                <Download size={14} /> 日志文件
              </Button>
              <Button onClick={clearLogs} size="compact" variant="secondary">清空</Button>
            </div>
          </div>
          <div className="dd-log-content">
            {logs.length === 0 && <p className="dd-hint">暂无日志，点击上方操作即可看到输出</p>}
            {logs.map((entry) => (
              <div key={entry.id} className={`dd-log-entry dd-log-${entry.level}`}>
                <span className="dd-log-time">{entry.time}</span>
                <span className="dd-log-msg">{entry.message}</span>
                {entry.data !== undefined ? (
                  <code className="dd-log-data">{JSON.stringify(entry.data)}</code>
                ) : null}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
