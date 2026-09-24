import { useCallback, useEffect, useRef, useState } from 'react'

import type { LiveStreamAudioMonitorFrame } from '../shared/types'

const BASE_LEAD_SECONDS = 0.06
const DELAY_CHANGE_DEBOUNCE_MS = 150
const MAX_SCHEDULE_AHEAD_SECONDS = 11

function clampDelay(value: number): number {
  return Math.min(10_000, Math.max(-10_000, Math.round(value)))
}

export function usePcmAudioMonitor(
  canMonitor: boolean,
  audioDelayMs: number,
  phoneFramesEnabled = true,
  sourceKey = 'phone',
) {
  const contextRef = useRef<AudioContext | null>(null)
  const nextStartTimeRef = useRef(0)
  const enabledRef = useRef(false)
  const delayMsRef = useRef(clampDelay(audioDelayMs))
  const appliedDelayMsRef = useRef(clampDelay(audioDelayMs))
  const scheduledSourcesRef = useRef(new Set<AudioBufferSourceNode>())
  const pendingTimerRef = useRef<number | null>(null)
  const phoneFramesEnabledRef = useRef(phoneFramesEnabled)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startDelayMs, setStartDelayMs] = useState(0)

  delayMsRef.current = clampDelay(audioDelayMs)
  phoneFramesEnabledRef.current = phoneFramesEnabled

  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current == null) return
    window.clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = null
  }, [])

  const clearScheduledSources = useCallback(() => {
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop()
      } catch {
        // The source may already have finished.
      }
    }
    scheduledSourcesRef.current.clear()
  }, [])

  const resetTimeline = useCallback(() => {
    const context = contextRef.current
    if (!context) return
    clearScheduledSources()
    clearPendingTimer()
    const delayMs = Math.max(0, delayMsRef.current)
    nextStartTimeRef.current = context.currentTime + BASE_LEAD_SECONDS + delayMs / 1_000
    appliedDelayMsRef.current = delayMsRef.current
    setStartDelayMs(delayMs)
    if (delayMs > 0) {
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null
        setStartDelayMs(0)
      }, delayMs)
    }
  }, [clearPendingTimer, clearScheduledSources])

  const stop = useCallback((notifyMain = true) => {
    enabledRef.current = false
    nextStartTimeRef.current = 0
    clearScheduledSources()
    clearPendingTimer()
    setEnabled(false)
    setStartDelayMs(0)
    const context = contextRef.current
    contextRef.current = null
    if (context) void context.close().catch(() => undefined)
    if (notifyMain) void window.luna.liveStream.setAudioMonitor(false).catch(() => undefined)
  }, [clearPendingTimer, clearScheduledSources])

  const pushFrame = useCallback((frame: LiveStreamAudioMonitorFrame) => {
    if (!enabledRef.current) return
    const bytes = frame.pcm16Le instanceof Uint8Array
      ? frame.pcm16Le
      : new Uint8Array(frame.pcm16Le)
    const context = contextRef.current
    if (!context || bytes.byteLength === 0 || frame.sampleCount <= 0) return

    try {
      const buffer = context.createBuffer(frame.channels, frame.sampleCount, frame.sampleRate)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (let channel = 0; channel < frame.channels; channel += 1) {
        const samples = buffer.getChannelData(channel)
        for (let index = 0; index < frame.sampleCount; index += 1) {
          samples[index] = view.getInt16((index * frame.channels + channel) * 2, true) / 32_768
        }
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      scheduledSourcesRef.current.add(source)
      source.onended = () => scheduledSourcesRef.current.delete(source)
      const now = context.currentTime
      if (nextStartTimeRef.current < now + 0.04 || nextStartTimeRef.current - now > MAX_SCHEDULE_AHEAD_SECONDS) {
        nextStartTimeRef.current = now + 0.06
      }
      source.start(nextStartTimeRef.current)
      nextStartTimeRef.current += buffer.duration
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.luna.liveStream.onAudioMonitorFrame((frame: LiveStreamAudioMonitorFrame) => {
      if (!phoneFramesEnabledRef.current) return
      pushFrame(frame)
    })
    return unsubscribe
  }, [pushFrame])

  useEffect(() => {
    if (!enabledRef.current) return undefined
    const timer = window.setTimeout(() => {
      if (!enabledRef.current || delayMsRef.current === appliedDelayMsRef.current) return
      resetTimeline()
    }, DELAY_CHANGE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [audioDelayMs, resetTimeline])

  useEffect(() => {
    if (enabledRef.current) resetTimeline()
  }, [resetTimeline, sourceKey])

  useEffect(() => {
    if (canMonitor || !enabledRef.current) return
    stop()
  }, [canMonitor, stop])

  useEffect(() => () => {
    if (enabledRef.current) stop()
  }, [stop])

  const toggle = useCallback(async (nextEnabled: boolean) => {
    setError(null)
    if (!nextEnabled) {
      stop()
      return
    }
    if (!canMonitor) {
      setError('请先开始获取画面')
      return
    }
    try {
      const context = new AudioContext()
      await context.resume()
      await window.luna.liveStream.setAudioMonitor(true)
      contextRef.current = context
      enabledRef.current = true
      resetTimeline()
      setEnabled(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      stop(false)
    }
  }, [canMonitor, resetTimeline, stop])

  return { enabled, error, pushFrame, startDelayMs, toggle }
}
