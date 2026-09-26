import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Circle,
  Copy,
  Download,
  Mic,
  Radio,
  Square,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Button, IconButton, Input, Select, Switch, Tooltip, toast } from '../ui'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import { LiveStreamReplayControl } from './LiveStreamReplayControl'
import { isDesktopAudioInput, useDesktopMicrophone } from '../hooks/useDesktopMicrophone'
import { usePcmAudioMonitor } from '../hooks/usePcmAudioMonitor'
import type {
  LiveStreamAudioInputOption,
  LiveStreamControlCommand,
  LiveStreamStatus,
} from '../shared/types'
import '../styles/live-control-panel.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Fall back to the document copy command for desktop windows without Clipboard API access.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('copy failed')
}

interface LiveControlPanelProps {
  status: LiveStreamStatus
  busy: boolean
  onStart: () => void
  enhanceQuality: boolean
  onEnhanceQualityChange: (enabled: boolean) => void
  onStartOutput: () => void
  onStopOutput: () => void
}

function audioOptionLabel(option: LiveStreamAudioInputOption): string {
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
  busy,
  onStart,
  enhanceQuality,
  onEnhanceQualityChange,
  onStartOutput,
  onStopOutput,
}: LiveControlPanelProps) {
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [pullUrlCopied, setPullUrlCopied] = useState(false)
  const [savedCapturePath, setSavedCapturePath] = useState<string | null>(null)
  const [captureBusy, setCaptureBusy] = useState(false)
  const [capturePathCopied, setCapturePathCopied] = useState(false)
  const [captureActiveOverride, setCaptureActiveOverride] = useState<boolean | null>(null)
  const [phoneMicrophoneOptions, setPhoneMicrophoneOptions] = useState<LiveStreamAudioInputOption[]>([
    { id: 'none', label: '关闭', kind: 'none' },
    { id: 'phone-microphone', label: '手机麦克风', kind: 'phone-microphone' },
  ])
  const [microphoneId, setMicrophoneId] = useState('phone-microphone')

  const active = Boolean(status.startedAt) && status.state !== 'stopping'
  const streaming = status.usbState === 'streaming'
  useEffect(() => {
    setCaptureActiveOverride(status.captureActive)
    if (status.capturePath) setSavedCapturePath(status.capturePath)
  }, [status.captureActive, status.capturePath])

  const desktopMicrophoneSelected = isDesktopAudioInput(microphoneId)
  const canMonitorAudio = desktopMicrophoneSelected ? active : status.usbState === 'streaming'
  const audioMonitor = usePcmAudioMonitor(
    canMonitorAudio,
    0,
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
    void window.luna.liveStream.sendAudioFrame(frame).catch(() => undefined)
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

  const send = useCallback((command: LiveStreamControlCommand) => {
    void window.luna.liveStream.sendControl(command).catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.luna.liveStream
      .setAudioSource(desktopMicrophoneSelected ? 'desktop' : 'phone')
      .catch(() => undefined)
    if (!status.controlReady) return
    send({ type: 'audio.selectInput', inputId: desktopMicrophoneSelected ? 'none' : effectiveMicrophoneId })
  }, [desktopMicrophoneSelected, effectiveMicrophoneId, send, status.controlReady, status.startedAt])

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
    setPreviewAspectRatio(dimensions.width / dimensions.height)
    setPreviewReady(true)
    setPreviewError(null)
  }, [])

  const handlePreviewError = useCallback((message: string) => {
    setPreviewReady(false)
    setPreviewError(message)
  }, [])

  const copyPullUrl = useCallback(async () => {
    if (!status.pullUrl) return
    try {
      await copyText(status.pullUrl)
      setPullUrlCopied(true)
      toast.success('地址已复制')
      window.setTimeout(() => setPullUrlCopied(false), 1_500)
    } catch {
      toast.error('无法复制地址')
    }
  }, [status.pullUrl])

  const capturePath = status.capturePath ?? savedCapturePath
  const capturing = captureActiveOverride ?? status.captureActive

  const toggleCapture = useCallback(async () => {
    if (captureBusy) return
    setCaptureBusy(true)
    try {
      if (capturing) {
        const path = await window.luna.liveStream.stopCapture()
        setCaptureActiveOverride(false)
        setSavedCapturePath(path)
        toast.success('样本已保存')
      } else {
        const path = await window.luna.liveStream.startCapture()
        setCaptureActiveOverride(true)
        setSavedCapturePath(path)
        toast.success('开始采集')
      }
    } catch {
      toast.error(capturing ? '无法保存样本' : '无法开始采集')
    } finally {
      setCaptureBusy(false)
    }
  }, [captureBusy, capturing])

  const copyCapturePath = useCallback(async () => {
    if (!capturePath) return
    try {
      await copyText(capturePath)
      setCapturePathCopied(true)
      toast.success('路径已复制')
      window.setTimeout(() => setCapturePathCopied(false), 1_500)
    } catch {
      toast.error('无法复制路径')
    }
  }, [capturePath])

  const controlStatus = status.lastControlResult?.ok === false
    ? status.lastControlResult.error
    : status.outputMessage
      ? status.outputMessage
    : status.controlReady
      ? '已连接'
      : status.usbMessage
  const canStartOutput = active && status.usbState !== 'error'

  return (
    <section className="live-control-panel" aria-label="直播控制">
      <div ref={previewPaneRef} className="live-preview-pane">
        <div
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
                <Button
                  variant="primary"
                  icon={<Video size={15} />}
                  onClick={onStart}
                  disabled={busy}
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
          <span className={status.controlReady ? 'ready' : ''}>{controlStatus}</span>
        </div>

        {status.outputEnabled && !status.outputReady && (
          <div className="live-control-notice">
            <span>{status.outputMessage ?? '正在准备直播地址'}</span>
          </div>
        )}
        {status.outputWarning && (
          <div className="live-control-warning" role="status">
            <span>{status.outputWarning}</span>
          </div>
        )}

        <section className="live-control-section">
          <h2>直播输出</h2>
          <div className="live-control-section-body">
            <label className="live-control-block">
              <span>拉流地址</span>
              <div className="live-pull-url-row">
                <Input
                  variant="compact"
                  fullWidth
                  value={status.pullUrl ?? ''}
                  placeholder="开始输出后生成"
                  readOnly
                />
                <Tooltip content={pullUrlCopied ? '已复制' : '复制地址'}>
                  <IconButton
                    variant="outline"
                    size="compact"
                    icon={pullUrlCopied ? <Check size={14} /> : <Copy size={14} />}
                    aria-label="复制拉流地址"
                    title="复制拉流地址"
                    onClick={() => void copyPullUrl()}
                    disabled={!status.pullUrl}
                  />
                </Tooltip>
              </div>
            </label>
            <div className="live-output-setting">
              <span>1080P 画质增强</span>
              <Switch
                checked={enhanceQuality}
                onCheckedChange={onEnhanceQualityChange}
                ariaLabel="1080P 画质增强"
                disabled={status.outputEnabled || busy}
              />
            </div>
            <Button
              variant={status.outputEnabled ? 'danger' : 'primary'}
              icon={status.outputEnabled ? <Square size={15} /> : <Radio size={15} />}
              onClick={status.outputEnabled ? onStopOutput : onStartOutput}
              disabled={busy || (!status.outputEnabled && !canStartOutput)}
            >
              {status.outputEnabled ? '停止输出' : '开始输出'}
            </Button>
            <div className="live-capture-tools">
              <Button
                variant={capturing ? 'danger' : 'secondary'}
                size="compact"
                icon={capturing ? <Square size={14} /> : <Circle size={14} />}
                onClick={() => void toggleCapture()}
                disabled={captureBusy || !active}
              >
                {captureBusy ? '处理中...' : capturing ? '停止采集' : '采集样本'}
              </Button>
              {capturePath && (
                <div className="live-capture-path-row">
                  <Input variant="compact" fullWidth value={capturePath} readOnly aria-label="样本文件路径" />
                  <Tooltip content={capturePathCopied ? '已复制' : '复制路径'}>
                    <IconButton
                      variant="outline"
                      size="compact"
                      icon={capturePathCopied ? <Check size={14} /> : <Copy size={14} />}
                      aria-label="复制样本路径"
                      title="复制样本路径"
                      onClick={() => void copyCapturePath()}
                    />
                  </Tooltip>
                </div>
              )}
              <LiveStreamReplayControl captureActive={capturing} enhanceQuality={enhanceQuality} />
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
          </div>
        </section>
      </aside>
    </section>
  )
}
