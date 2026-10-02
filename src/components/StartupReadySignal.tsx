import { useEffect } from 'react'
import { useDeviceConnection } from '../context/DeviceConnectionContext'

export function StartupReadySignal() {
  const { initialized } = useDeviceConnection()
  useEffect(() => {
    if (!initialized) return
    let paintedFrame = 0
    const readyFrame = requestAnimationFrame(() => {
      paintedFrame = requestAnimationFrame(() => window.luna.startupReady())
    })
    return () => {
      cancelAnimationFrame(readyFrame)
      cancelAnimationFrame(paintedFrame)
    }
  }, [initialized])
  return null
}
