import { FlipVertical2, LocateFixed, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

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
  const [joyPosition, setJoyPosition] = useState({ x: 0, y: 0 })
  const [flipped, setFlipped] = useState(false)
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

  const keyGimbal = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const offsets: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 },
    }
    const next = offsets[event.key]
    if (!next) return
    event.preventDefault()
    if (event.repeat) return
    setJoyPosition(next)
    dispatch({ type: 'gimbal.move', horizontal: next.x, vertical: next.y })
  }

  const releaseGimbal = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith('Arrow')) return
    setJoyPosition({ x: 0, y: 0 })
    dispatch({ type: 'gimbal.stop' })
  }

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
          tabIndex={0}
          onPointerDown={startGimbal}
          onPointerMove={moveGimbal}
          onPointerUp={stopGimbal}
          onPointerCancel={stopGimbal}
          onKeyDown={keyGimbal}
          onKeyUp={releaseGimbal}
          onBlur={() => {
            setJoyPosition({ x: 0, y: 0 })
            dispatch({ type: 'gimbal.stop' })
          }}
        >
          <div className="live-gimbal-crosshair" />
          <div
            className="live-gimbal-knob"
            style={{ transform: `translate(${joyPosition.x * 42}px, ${-joyPosition.y * 42}px)` }}
          >
            {flipped ? <FlipVertical2 size={18} /> : <LocateFixed size={18} />}
          </div>
        </div>
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
            onClick={() => {
              setFlipped((current) => !current)
              dispatch({ type: 'gimbal.flip' })
            }}
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
          onChange={setExposure}
          onPreviewChange={setExposure}
          onCommit={(value) => {
            setExposure(value)
            dispatch({ type: 'exposure.set', value })
          }}
        />
      </section>

      <section className="live-control-section">
        <header>
          <span>对焦</span>
        </header>
        <p className="live-preview-control-hint">点击画面选择对焦位置</p>
      </section>
    </div>
  )
}
