import { FlipVertical2, LocateFixed, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { bindLiveGimbalKeyboard } from '../lib/liveGimbalKeyboard'

import type {
  LiveStreamControlCommand,
  LiveStreamControlCapabilities,
  LiveStreamStatus,
} from '../shared/types'
import { Button } from '../ui'
import { ParamSlider } from '../workspace/components/ParamSlider'
import '../styles/live-camera-controls.css'

interface LiveCameraControlPanelProps {
  status: LiveStreamStatus
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const DEFAULT_CAPABILITIES: LiveStreamControlCapabilities = {
  gimbal: { supported: true, continuous: true },
  zoom: { supported: true, min: 1, max: 12, step: 0.1, presets: [1], current: 1 },
  focus: { tap: true },
  tracking: { region: true },
  exposure: { supported: true, min: -4, max: 4, step: 0.1, stops: [0], current: 0 },
}

export function LiveCameraControlPanel({ status }: LiveCameraControlPanelProps) {
  const capabilities = status.capabilities ?? DEFAULT_CAPABILITIES
  const controlReady = status.controlReady && status.receiverConnected
  const padRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  const keyboardHintId = useId()
  const [joyPosition, setJoyPosition] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(capabilities.zoom.current)
  const [exposure, setExposure] = useState(capabilities.exposure.current)
  const currentZoom = capabilities.zoom.current
  const currentExposure = capabilities.exposure.current

  const dispatch = useCallback((command: LiveStreamControlCommand) => {
    if (!controlReady) return
    if (status.capabilities) {
      if (command.type.startsWith('gimbal.') && !capabilities.gimbal.supported) return
      if (command.type.startsWith('zoom.') && !capabilities.zoom.supported) return
      if (command.type === 'exposure.set' && !capabilities.exposure.supported) return
    }
    void window.luna.liveStream.sendControl(command).catch((reason: unknown) => {
      window.luna.log('warn', '直播控制指令发送失败', {
        type: command.type,
        error: reason instanceof Error ? reason.message : String(reason),
      })
    })
  }, [capabilities, controlReady, status.capabilities])

  const dispatchRef = useRef(dispatch)
  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  useEffect(() => {
    return bindLiveGimbalKeyboard({
      window,
      document,
      isPadTarget: (target) => target instanceof Node && Boolean(padRef.current?.contains(target)),
      isPointerActive: () => activePointer.current !== null,
      onMove: (position) => {
        if (activePointer.current !== null) return
        setJoyPosition(position)
        dispatchRef.current({ type: 'gimbal.move', horizontal: position.x, vertical: position.y })
      },
      onStop: () => {
        if (activePointer.current !== null) return
        setJoyPosition({ x: 0, y: 0 })
        dispatchRef.current({ type: 'gimbal.stop' })
      },
    })
  }, [capabilities.gimbal.supported, controlReady])

  useEffect(() => {
    setZoom(currentZoom)
  }, [currentZoom])

  useEffect(() => {
    setExposure(currentExposure)
  }, [currentExposure])

  useEffect(() => {
    if (!status.controlReady || status.capabilities) return
    dispatch({ type: 'capabilities.get' })
  }, [dispatch, status.capabilities, status.controlReady])

  const updateGimbal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
    const y = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1)
    setJoyPosition({ x, y })
    dispatch({ type: 'gimbal.move', horizontal: x, vertical: y })
  }, [dispatch])

  const startGimbal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointer.current = event.pointerId
    updateGimbal(event)
  }, [updateGimbal])

  const moveGimbal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return
    updateGimbal(event)
  }, [updateGimbal])

  const stopGimbal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePointer.current = null
    setJoyPosition({ x: 0, y: 0 })
    dispatch({ type: 'gimbal.stop' })
  }, [dispatch])

  return (
    <div className="live-camera-controls">
      <section className="live-control-section">
        <header>
          <span>云台</span>
          <span className={controlReady ? 'ready' : ''}>{controlReady ? '已连接' : '未连接'}</span>
        </header>
        <div
          ref={padRef}
          className="live-gimbal-pad"
          role="group"
          aria-label="云台方向控制"
          aria-describedby={keyboardHintId}
          data-moving={joyPosition.x !== 0 || joyPosition.y !== 0 ? '' : undefined}
          tabIndex={0}
          onPointerDown={startGimbal}
          onPointerMove={moveGimbal}
          onPointerUp={stopGimbal}
          onPointerCancel={stopGimbal}
          onBlur={() => {
            setJoyPosition({ x: 0, y: 0 })
            dispatch({ type: 'gimbal.stop' })
          }}
        >
          <div className="live-gimbal-crosshair" />
          <div
            className="live-gimbal-knob"
            style={{ transform: `translate(${joyPosition.x * 37}px, ${-joyPosition.y * 37}px)` }}
          >
            <LocateFixed size={18} />
          </div>
        </div>
        <p id={keyboardHintId} className="live-gimbal-keyboard-hint">WASD 中速 · Shift 全速 · 松开停止</p>
        <div className="live-control-button-row">
          <Button
            variant="toolbar"
            size="compact"
            icon={<RotateCcw size={14} />}
            onClick={() => {
              setJoyPosition({ x: 0, y: 0 })
              dispatch({ type: 'gimbal.center' })
            }}
          >
            回中
          </Button>
          <Button
            variant="toolbar"
            size="compact"
            icon={<FlipVertical2 size={14} />}
            onClick={() => dispatch({ type: 'gimbal.flip' })}
          >
            翻转
          </Button>
        </div>
      </section>

      <section className="live-control-section">
        <ParamSlider
          label="变焦"
          value={zoom}
          min={capabilities.zoom.min}
          max={capabilities.zoom.max}
          step={capabilities.zoom.step}
          formatValue={(value) => value.toFixed(1)}
          onChange={setZoom}
          onPreviewChange={(value) => {
            setZoom(value)
            dispatch({ type: 'zoom.preview', value })
          }}
          onCommit={(value) => {
            setZoom(value)
            dispatch({ type: 'zoom.set', value })
          }}
        />
      </section>

      <section className="live-control-section">
        <ParamSlider
          label="曝光"
          value={exposure}
          min={capabilities.exposure.min}
          max={capabilities.exposure.max}
          step={capabilities.exposure.step}
          formatValue={(value) => value.toFixed(1)}
          onChange={setExposure}
          onPreviewChange={setExposure}
          onCommit={(value) => {
            setExposure(value)
            dispatch({ type: 'exposure.set', value })
          }}
        />
      </section>

      <section className="live-control-section live-focus-section">
        <header>
          <span>对焦</span>
          <span>点击画面选择位置</span>
        </header>
      </section>
    </div>
  )
}
