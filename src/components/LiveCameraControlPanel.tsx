import { Crosshair, FlipVertical2, LocateFixed, RotateCcw, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type {
  LiveStreamControlCommand,
  LiveStreamControlCapabilities,
  LiveStreamStatus,
} from '../shared/types'
import { Button, Slider } from '../ui'

interface LiveCameraControlPanelProps {
  status: LiveStreamStatus
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function defaultCapabilities(): LiveStreamControlCapabilities {
  return {
    gimbal: { supported: false, continuous: false },
    zoom: { supported: false, min: 1, max: 12, step: 0.1, presets: [1], current: 1 },
    focus: { tap: false },
    tracking: { region: false },
    exposure: { supported: false, min: -4, max: 4, step: 0.1, stops: [0], current: 0 },
  }
}

export function LiveCameraControlPanel({ status }: LiveCameraControlPanelProps) {
  const capabilities = status.capabilities ?? defaultCapabilities()
  const controlReady = status.controlReady && status.receiverConnected
  const padRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  const [joyPosition, setJoyPosition] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(capabilities.zoom.current)
  const [exposure, setExposure] = useState(capabilities.exposure.current)
  const currentZoom = capabilities.zoom.current
  const currentExposure = capabilities.exposure.current

  const dispatch = useCallback((command: LiveStreamControlCommand) => {
    void window.luna.liveStream.sendControl(command).catch((reason: unknown) => {
      window.luna.log('warn', '直播控制指令发送失败', {
        type: command.type,
        error: reason instanceof Error ? reason.message : String(reason),
      })
    })
  }, [])

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
    if (!controlReady || !capabilities.gimbal.supported) return
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
    const y = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1)
    setJoyPosition({ x, y })
    dispatch({ type: 'gimbal.move', horizontal: x, vertical: y })
  }, [capabilities.gimbal.supported, controlReady, dispatch])

  const startGimbal = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlReady || !capabilities.gimbal.supported) return
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointer.current = event.pointerId
    updateGimbal(event)
  }, [capabilities.gimbal.supported, controlReady, updateGimbal])

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
          <span className={controlReady ? 'ready' : ''}>{controlReady ? '已连接' : '等待连接'}</span>
        </header>
        <div
          ref={padRef}
          className={`live-gimbal-pad${controlReady && capabilities.gimbal.supported ? '' : ' disabled'}`}
          role="application"
          aria-label="云台方向控制"
          onPointerDown={startGimbal}
          onPointerMove={moveGimbal}
          onPointerUp={stopGimbal}
          onPointerCancel={stopGimbal}
        >
          <div className="live-gimbal-crosshair" />
          <div
            className="live-gimbal-knob"
            style={{ transform: `translate(${joyPosition.x * 42}px, ${-joyPosition.y * 42}px)` }}
          >
            <LocateFixed size={18} />
          </div>
        </div>
        <div className="live-control-button-row">
          <Button
            variant="utility"
            size="compact"
            icon={<RotateCcw size={14} />}
            disabled={!controlReady || !capabilities.gimbal.supported}
            onClick={() => dispatch({ type: 'gimbal.center' })}
          >
            回中
          </Button>
          <Button
            variant="utility"
            size="compact"
            icon={<FlipVertical2 size={14} />}
            disabled={!controlReady || !capabilities.gimbal.supported}
            onClick={() => dispatch({ type: 'gimbal.flip' })}
          >
            翻转
          </Button>
        </div>
      </section>

      <section className="live-control-section">
        <header>
          <span>变焦</span>
          <strong>{zoom.toFixed(1)}x</strong>
        </header>
        <Slider
          ariaLabel="直播变焦"
          value={zoom}
          min={capabilities.zoom.min}
          max={capabilities.zoom.max}
          step={capabilities.zoom.step}
          disabled={!controlReady || !capabilities.zoom.supported}
          onValueChange={(value) => {
            setZoom(value)
            dispatch({ type: 'zoom.preview', value })
          }}
          onValueCommit={(value) => dispatch({ type: 'zoom.set', value })}
        />
      </section>

      <section className="live-control-section">
        <header>
          <span>曝光</span>
          <strong>{exposure >= 0 ? '+' : ''}{exposure.toFixed(1)} EV</strong>
        </header>
        <Slider
          ariaLabel="直播曝光补偿"
          value={exposure}
          min={capabilities.exposure.min}
          max={capabilities.exposure.max}
          step={capabilities.exposure.step}
          disabled={!controlReady || !capabilities.exposure.supported}
          onValueChange={setExposure}
          onValueCommit={(value) => dispatch({ type: 'exposure.set', value })}
        />
      </section>

      <section className="live-control-section">
        <header>
          <span>跟踪</span>
          <span>{capabilities.tracking.region ? '可用' : '不可用'}</span>
        </header>
        <div className="live-control-button-row">
          <Button
            variant="utility"
            size="compact"
            icon={<Crosshair size={14} />}
            disabled={!controlReady || !capabilities.focus.tap}
            onClick={() => dispatch({ type: 'focus.tap', point: { x: 0.5, y: 0.5 } })}
          >
            中心对焦
          </Button>
          <Button
            variant="utility"
            size="compact"
            icon={<Square size={14} />}
            disabled={!controlReady || !capabilities.tracking.region}
            onClick={() => {
              dispatch({ type: 'tracking.stop' })
            }}
          >
            停止
          </Button>
        </div>
      </section>
    </div>
  )
}
