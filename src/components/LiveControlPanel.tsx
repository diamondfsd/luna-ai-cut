import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Download,
  Mic,
  MonitorUp,
  Settings2,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Button, Select, Slider } from '../ui'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import { LiveGimbalPad } from './LiveGimbalPad'
import { isDesktopAudioInput, useDesktopMicrophone } from '../hooks/useDesktopMicrophone'
import { usePcmAudioMonitor } from '../hooks/usePcmAudioMonitor'
import type {
  DesktopAudioInputOption,
  DesktopControlCommand,
  DesktopVirtualCameraStatus,
  NormalizedVideoRegion,
} from '../shared/types'
import '../styles/live-control-panel.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

interface LiveControlPanelProps {
  status: DesktopVirtualCameraStatus
  audioDelayMs: number
  busy: boolean
  canInstall: boolean
  needsApproval: boolean
  onAudioDelayChange: (value: number) => void
  onAudioDelayCommit: (value: number) => void
  onStart: () => void
  onInstall: () => void
  onOpenSettings: () => void
}

function contentPoint(
  element: HTMLDivElement,
  dimensions: { width: number; height: number },
  event: ReactPointerEvent<HTMLDivElement>,
): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  const sourceWidth = dimensions.width || rect.width
  const sourceHeight = dimensions.height || rect.height
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const left = rect.left + (rect.width - width) / 2
  const top = rect.top + (rect.height - height) / 2
  return {
    x: Math.min(1, Math.max(0, (event.clientX - left) / width)),
    y: Math.min(1, Math.max(0, (event.clientY - top) / height)),
  }
}

function formatZoom(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}x`
}

function audioOptionLabel(option: DesktopAudioInputOption): string {
  const label = option.label?.trim()
  if (label) return label
  if (option.kind === 'none') return '关闭'
  if (option.kind === 'phone-microphone') return '手机麦克风'
  if (option.kind === 'external' || option.kind === 'phone-external') return '手机外接麦克风'
  if (option.kind === 'desktop-microphone') return '电脑麦克风'
  return option.id
}

export function LiveControlPanel({
  status,
  audioDelayMs,
  busy,
  canInstall,
  needsApproval,
  onAudioDelayChange,
  onAudioDelayCommit,
  onStart,
  onInstall,
  onOpenSettings,
}: LiveControlPanelProps) {
  const previewStageRef = useRef<HTMLDivElement>(null)
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<{
    mode: 'pending' | 'tracking'
    start: { x: number; y: number }
  } | null>(null)
  const gimbalTimerRef = useRef<number | null>(null)
  const gimbalValueRef = useRef({ horizontal: 0, vertical: 0 })
  const zoomSessionRef = useRef<string | null>(null)
  const zoomControlledRef = useRef(false)
  const [selection, setSelection] = useState<NormalizedVideoRegion | null>(null)
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null)
  const [zoomValue, setZoomValue] = useState(1)
  const [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewDimensions, setPreviewDimensions] = useState({ width: 16, height: 9 })
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [phoneMicrophoneOptions, setPhoneMicrophoneOptions] = useState<DesktopAudioInputOption[]>([
    { id: 'none', label: '关闭', kind: 'none' },
    { id: 'phone-microphone', label: '手机麦克风', kind: 'phone-microphone' },
  ])
  const [microphoneId, setMicrophoneId] = useState('phone-microphone')

  const active = status.state === 'running' || status.state === 'waiting-usb' || status.state === 'starting'
  const streaming = status.usbState === 'streaming'
  const disabled = !status.controlReady
  const capabilities = status.capabilities
  const desktopMicrophoneSelected = isDesktopAudioInput(microphoneId)
  const canMonitorAudio = desktopMicrophoneSelected ? active : status.usbState === 'streaming'
  const audioMonitor = usePcmAudioMonitor(
    canMonitorAudio,
    audioDelayMs,
    !desktopMicrophoneSelected,
    microphoneId,
  )
  const { pushFrame: pushPcmFrame } = audioMonitor
  const handleDesktopAudioFrame = useCallback((frame: {
    sampleRate: number
    channels: number
    sampleCount: number
    pcm16Le: Uint8Array
  }) => {
    pushPcmFrame(frame)
    void window.luna.desktopVirtualCamera.sendAudioFrame(frame).catch(() => undefined)
  }, [pushPcmFrame])
  const desktopMicrophone = useDesktopMicrophone({
    selectedInputId: microphoneId,
    onFrame: handleDesktopAudioFrame,
  })
  const microphoneOptions = useMemo(
    () => [...phoneMicrophoneOptions, ...desktopMicrophone.options].map((option) => ({
      ...option,
      label: audioOptionLabel(option),
    })),
    [desktopMicrophone.options, phoneMicrophoneOptions],
  )
  const selectedMicrophone = microphoneOptions.find((option) => option.id === microphoneId)
    ?? microphoneOptions.find((option) => option.kind === 'phone-microphone')
    ?? microphoneOptions[0]
  const effectiveMicrophoneId = selectedMicrophone?.id ?? microphoneId

  const send = useCallback((command: DesktopControlCommand) => {
    void window.luna.desktopVirtualCamera.sendControl(command).catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.luna.desktopVirtualCamera
      .setAudioSource(desktopMicrophoneSelected ? 'desktop' : 'phone')
      .catch(() => undefined)
    if (!status.controlReady) return
    send({ type: 'audio.selectInput', inputId: desktopMicrophoneSelected ? 'none' : effectiveMicrophoneId })
  }, [desktopMicrophoneSelected, effectiveMicrophoneId, send, status.controlReady, status.startedAt])

  const stopGimbal = useCallback(() => {
    if (gimbalTimerRef.current != null) window.clearInterval(gimbalTimerRef.current)
    gimbalTimerRef.current = null
    gimbalValueRef.current = { horizontal: 0, vertical: 0 }
    send({ type: 'gimbal.stop' })
  }, [send])

  const moveGimbal = useCallback((horizontal: number, vertical: number) => {
    gimbalValueRef.current = { horizontal, vertical }
    send({ type: 'gimbal.move', horizontal, vertical })
    if (gimbalTimerRef.current == null) {
      gimbalTimerRef.current = window.setInterval(() => {
        const value = gimbalValueRef.current
        send({ type: 'gimbal.move', horizontal: value.horizontal, vertical: value.vertical })
      }, 100)
    }
  }, [send])

  useEffect(() => () => {
    if (gimbalTimerRef.current != null) window.clearInterval(gimbalTimerRef.current)
  }, [])

  useEffect(() => {
    if (!status.controlReady || status.capabilities) return undefined
    const request = () => send({ type: 'capabilities.get' })
    request()
    const timer = window.setInterval(request, 1_500)
    return () => window.clearInterval(timer)
  }, [send, status.capabilities, status.controlReady])

  useEffect(() => {
    const next = status.capabilities
    if (!next) return
    const sessionKey = status.startedAt ?? 'active'
    if (zoomSessionRef.current !== sessionKey) {
      zoomSessionRef.current = sessionKey
      zoomControlledRef.current = false
    }
    if (!zoomControlledRef.current) setZoomValue(next.zoom.current)
    if (next.audio.options.length > 0) {
      const options = next.audio.options.map((option) => ({ ...option, label: audioOptionLabel(option) }))
      setPhoneMicrophoneOptions(options)
      setMicrophoneId((current) => (
        isDesktopAudioInput(current) || options.some((option) => option.id === current)
          ? current
          : options.some((option) => option.id === next.audio.selectedId)
            ? next.audio.selectedId
            : options.find((option) => option.kind === 'phone-microphone')?.id ?? options[0]?.id ?? 'phone-microphone'
      ))
    }
  }, [status.capabilities, status.startedAt])

  useEffect(() => {
    const pane = previewPaneRef.current
    if (!pane) return undefined
    const update = () => {
      const rect = pane.getBoundingClientRect()
      let width = rect.width
      let height = width / previewAspectRatio
      if (height > rect.height) {
        height = rect.height
        width = height * previewAspectRatio
      }
      setPreviewStageSize({ width: Math.max(0, width), height: Math.max(0, height) })
    }
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    update()
    return () => observer.disconnect()
  }, [previewAspectRatio])

  const handlePreviewFrame = useCallback((dimensions: { width: number; height: number }) => {
    setPreviewDimensions((current) => (
      current.width === dimensions.width && current.height === dimensions.height ? current : dimensions
    ))
    setPreviewAspectRatio(dimensions.width / dimensions.height)
    setPreviewReady(true)
    setPreviewError(null)
  }, [])

  const handlePreviewError = useCallback((message: string) => {
    setPreviewReady(false)
    setPreviewError(message)
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !previewReady || !previewStageRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = contentPoint(previewStageRef.current, previewDimensions, event)
    gestureRef.current = { mode: 'pending', start }
    setSelection(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || !previewStageRef.current) return
    const current = contentPoint(previewStageRef.current, previewDimensions, event)
    if (gesture.mode === 'pending') {
      const horizontal = Math.abs(current.x - gesture.start.x)
      const vertical = Math.abs(current.y - gesture.start.y)
      if (Math.max(horizontal, vertical) < 0.015) return
      gesture.mode = 'tracking'
    }
    setSelection({
      x: Math.min(gesture.start.x, current.x),
      y: Math.min(gesture.start.y, current.y),
      width: Math.abs(current.x - gesture.start.x),
      height: Math.abs(current.y - gesture.start.y),
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (!gesture || !previewStageRef.current) return
    const end = contentPoint(previewStageRef.current, previewDimensions, event)
    if (gesture.mode === 'pending') {
      if (!capabilities?.focus.tap) return
      setFocusPoint(end)
      send({ type: 'focus.tap', point: end })
      return
    }
    const region = {
      x: Math.min(gesture.start.x, end.x),
      y: Math.min(gesture.start.y, end.y),
      width: Math.abs(end.x - gesture.start.x),
      height: Math.abs(end.y - gesture.start.y),
    }
    if (capabilities?.tracking.region && (region.width >= 0.04 || region.height >= 0.04)) {
      setSelection(region)
      send({ type: 'tracking.selectRegion', region })
    }
  }

  const controlStatus = status.lastControlResult?.ok === false
    ? status.lastControlResult.error
    : status.outputMessage
      ? status.outputMessage
    : status.controlReady
      ? '控制已连接'
      : status.usbMessage

  return (
    <section className="live-control-panel" aria-label="直播控制">
      <div ref={previewPaneRef} className="live-preview-pane">
        <div
          ref={previewStageRef}
          className="live-preview-stage"
          style={{ width: previewStageSize.width, height: previewStageSize.height }}
        >
          {status.localPreviewUrl && (
            <AnnexBVideoCanvas
              url={status.localPreviewUrl}
              className="live-preview-canvas"
              onFrame={handlePreviewFrame}
              onError={handlePreviewError}
            />
          )}

          <div
            className="live-preview-interaction"
            data-ready={disabled ? 'false' : String(previewReady)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {selection && (
              <span
                className="live-preview-selection"
                style={{
                  left: `${selection.x * 100}%`,
                  top: `${selection.y * 100}%`,
                  width: `${selection.width * 100}%`,
                  height: `${selection.height * 100}%`,
                }}
              />
            )}
            {focusPoint && (
              <span className="live-preview-focus" style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }} />
            )}
          </div>

          {!active && (
            <div className="live-preview-overlay live-preview-onboarding">
              <ol>
                <li>
                  <span>1</span>
                  <p>打开 Luna 咔，连接相机</p>
                  {!status.receiverConnected && (
                    <Button
                      variant="secondary"
                      size="mini"
                      icon={<Download size={14} />}
                      onClick={() => void window.luna.openPath(MOBILE_APP_DOWNLOAD_URL)}
                    >
                      下载 App
                    </Button>
                  )}
                </li>
                <li><span>2</span><p>用 USB 连接手机和电脑</p></li>
              </ol>
              <div className="live-preview-actions">
                {canInstall && (
                  <Button variant="secondary" icon={<MonitorUp size={15} />} onClick={onInstall} disabled={busy}>
                    {status.hostAppInstalled ? '安装虚拟麦克风' : '安装音视频组件'}
                  </Button>
                )}
                {needsApproval && (
                  <Button variant="secondary" icon={<Settings2 size={15} />} onClick={onOpenSettings} disabled={busy}>
                    打开系统设置
                  </Button>
                )}
                <Button
                  variant="primary"
                  icon={<Video size={15} />}
                  onClick={onStart}
                  disabled={busy || status.state === 'unsupported'}
                >
                  {busy ? '处理中...' : '获取画面'}
                </Button>
              </div>
            </div>
          )}

          {active && !streaming && (
            <div className="live-preview-overlay">
              <strong>{status.state === 'starting' ? '正在启动' : '等待手机连接'}</strong>
              {status.state !== 'starting' && <span>用 USB 连接手机和电脑</span>}
            </div>
          )}

          {streaming && (previewError || !previewReady) && (
            <div className="live-preview-overlay">
              <strong>{previewError ?? status.localPreviewError ?? (status.localPreviewUrl ? '正在打开直播画面' : '正在准备软件预览')}</strong>
            </div>
          )}
        </div>
      </div>

      <aside className="live-control-pane">
        <div className="live-preview-toolbar">
          <span>{capabilities ? '单击对焦，拖动框选' : status.controlReady ? '正在读取相机能力' : '连接手机后启用画面控制'}</span>
          <span className={status.controlReady ? 'ready' : ''}>{controlStatus}</span>
        </div>

        {(needsApproval || (status.outputEnabled && !status.outputReady)) && (
          <div className="live-control-notice">
            <span>{status.outputMessage ?? '虚拟摄像头当前不可用'}</span>
            {needsApproval && (
              <Button variant="secondary" size="mini" icon={<Settings2 size={14} />} onClick={onOpenSettings}>
                打开系统设置
              </Button>
            )}
          </div>
        )}

        <section className="live-control-section">
          <h2>画面</h2>
          <div className="live-control-section-body">
            <div className="live-control-cluster">
              <div className="live-control-block live-gimbal-control">
                <span>云台</span>
                <LiveGimbalPad
                  disabled={disabled || !capabilities?.gimbal.supported}
                  onMove={moveGimbal}
                  onStop={stopGimbal}
                />
              </div>

              <div className="live-control-block live-zoom-control">
                <span>焦段</span>
                <Slider
                  className="live-zoom-slider"
                  value={zoomValue}
                  min={capabilities?.zoom.min ?? 1}
                  max={capabilities?.zoom.max ?? 1}
                  step={capabilities?.zoom.step ?? 0.1}
                  ariaLabel="焦段"
                  disabled={disabled || !capabilities?.zoom.supported}
                  onValueChange={(value) => {
                    zoomControlledRef.current = true
                    setZoomValue(value)
                    send({ type: 'zoom.preview', value })
                  }}
                  onValueCommit={(value) => {
                    zoomControlledRef.current = true
                    setZoomValue(value)
                    send({ type: 'zoom.set', value })
                  }}
                />
                <div className="live-zoom-range">
                  <output>{formatZoom(zoomValue)}</output>
                  <span>
                    <span>{formatZoom(capabilities?.zoom.min ?? 1)}</span>
                    <span>{formatZoom(capabilities?.zoom.max ?? 1)}</span>
                  </span>
                </div>
              </div>
            </div>

          </div>
        </section>

        <section className="live-control-section">
          <h2>声音</h2>
          <div className="live-control-section-body">
            <label className="live-control-block">
              <span>麦克风音源</span>
              <Select
                variant="compact"
                fullWidth
                icon={<Mic size={14} />}
                value={effectiveMicrophoneId}
                options={microphoneOptions.map((option) => ({ value: option.id, label: option.label }))}
                onValueChange={setMicrophoneId}
                disabled={!active}
              />
            </label>

            <div className="live-control-output">
              <span>音频测试</span>
              <strong className={desktopMicrophone.active || status.audioFrames > 0 ? 'ready' : undefined}>
                {audioMonitor.enabled && audioMonitor.startDelayMs > 0
                  ? `延迟 ${(audioMonitor.startDelayMs / 1_000).toFixed(1)} 秒播放`
                  : desktopMicrophoneSelected
                  ? desktopMicrophone.error
                    ?? (desktopMicrophone.active
                      ? `电脑麦克风 · ${(desktopMicrophone.sampleRate ?? 0) / 1_000} kHz · ${desktopMicrophone.channels ?? 0} 声道`
                      : '正在打开电脑麦克风')
                  : status.audioFrames > 0
                  ? `${status.audioFrames} 帧 · ${(status.audioSampleRate ?? 0) / 1000} kHz · ${status.audioChannels ?? 0} 声道`
                  : '未收到音频'}
              </strong>
              <Button
                variant={audioMonitor.enabled ? 'danger' : 'secondary'}
                size="compact"
                icon={audioMonitor.enabled ? <VolumeX size={14} /> : <Volume2 size={14} />}
                onClick={() => void audioMonitor.toggle(!audioMonitor.enabled)}
                disabled={!canMonitorAudio}
              >
                {audioMonitor.enabled ? '停止播放' : '播放音频'}
              </Button>
            </div>
            {audioMonitor.error && <span className="live-control-error">{audioMonitor.error}</span>}

            <div className="live-control-output">
              <span>虚拟麦克风</span>
              <strong>{status.virtualMicrophoneInstalled ? status.virtualMicrophoneName : '尚未安装'}</strong>
              {canInstall && (
                <Button variant="secondary" size="mini" icon={<MonitorUp size={14} />} onClick={onInstall} disabled={busy}>
                  安装
                </Button>
              )}
            </div>

            <label className="live-control-block">
              <span>声音漂移 <output>{audioDelayMs > 0 ? '+' : ''}{audioDelayMs} ms</output></span>
              <Slider value={audioDelayMs} min={-10_000} max={10_000} step={10} ariaLabel="声音漂移" onValueChange={onAudioDelayChange} onValueCommit={onAudioDelayCommit} />
            </label>
          </div>
        </section>
      </aside>
    </section>
  )
}
