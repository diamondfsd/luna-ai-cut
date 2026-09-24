import { useCallback, useEffect, useRef, useState } from 'react'

import type { LiveStreamAudioInputFrame, LiveStreamAudioInputOption } from '../shared/types'

const DESKTOP_AUDIO_PREFIX = 'desktop:'
const DESKTOP_DEFAULT_ID = `${DESKTOP_AUDIO_PREFIX}default`
const CAPTURE_WORKLET_NAME = 'luna-pcm16-capture'
const CAPTURE_WORKLET_SOURCE = `
class LunaPcm16CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0 || input[0].length === 0) return true
    const channels = input.length
    const sampleCount = input[0].length
    const pcm = new Int16Array(sampleCount * channels)
    for (let frame = 0; frame < sampleCount; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, input[channel][frame] || 0))
        pcm[frame * channels + channel] = sample < 0 ? sample * 32768 : sample * 32767
      }
    }
    this.port.postMessage({ sampleRate, channels, sampleCount, pcm16Le: pcm.buffer }, [pcm.buffer])
    return true
  }
}
registerProcessor('${CAPTURE_WORKLET_NAME}', LunaPcm16CaptureProcessor)
`

interface UseDesktopMicrophoneOptions {
  selectedInputId: string
  onFrame: (frame: LiveStreamAudioInputFrame) => void
}

function deviceInputId(deviceId: string): string {
  return `${DESKTOP_AUDIO_PREFIX}${deviceId}`
}

function deviceIdFromInput(inputId: string): string | null {
  const deviceId = inputId.slice(DESKTOP_AUDIO_PREFIX.length)
  return deviceId && deviceId !== 'default' ? deviceId : null
}

export function isDesktopAudioInput(inputId: string): boolean {
  return inputId.startsWith(DESKTOP_AUDIO_PREFIX)
}

export function useDesktopMicrophone({ selectedInputId, onFrame }: UseDesktopMicrophoneOptions) {
  const onFrameRef = useRef(onFrame)
  const [options, setOptions] = useState<LiveStreamAudioInputOption[]>([
    { id: DESKTOP_DEFAULT_ID, label: '电脑默认麦克风', kind: 'desktop-microphone' },
  ])
  const [active, setActive] = useState(false)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [channels, setChannels] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  onFrameRef.current = onFrame

  const refresh = useCallback(async (requestPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      if (requestPermission) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        for (const track of permissionStream.getTracks()) track.stop()
      }
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'audioinput')
      const next: LiveStreamAudioInputOption[] = [
        { id: DESKTOP_DEFAULT_ID, label: '电脑默认麦克风', kind: 'desktop-microphone' },
      ]
      for (const [index, device] of devices.entries()) {
        if (!device.deviceId) continue
        next.push({
          id: deviceInputId(device.deviceId),
          label: device.label || `麦克风 ${index + 1}`,
          kind: 'desktop-microphone',
          deviceId: device.deviceId,
        })
      }
      setOptions(next)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    const handleDeviceChange = () => void refresh(false)
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
  }, [refresh])

  useEffect(() => {
    if (!isDesktopAudioInput(selectedInputId)) {
      setActive(false)
      setSampleRate(null)
      setChannels(null)
      return undefined
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前系统不支持读取电脑麦克风')
      return undefined
    }

    let cancelled = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let worklet: AudioWorkletNode | null = null
    let silentGain: GainNode | null = null
    let moduleUrl: string | null = null

    const start = async () => {
      try {
        setError(null)
        const deviceId = deviceIdFromInput(selectedInputId)
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        })
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }

        context = new AudioContext()
        moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }))
        await context.audioWorklet.addModule(moduleUrl)
        if (cancelled) return

        source = context.createMediaStreamSource(stream)
        worklet = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME)
        silentGain = context.createGain()
        silentGain.gain.value = 0
        worklet.port.onmessage = (event: MessageEvent<LiveStreamAudioInputFrame>) => {
          if (cancelled || !event.data?.pcm16Le) return
          const pcm16Le = event.data.pcm16Le instanceof Uint8Array
            ? event.data.pcm16Le
            : new Uint8Array(event.data.pcm16Le)
          onFrameRef.current({ ...event.data, pcm16Le })
        }
        source.connect(worklet)
        worklet.connect(silentGain).connect(context.destination)
        await context.resume()
        if (cancelled) return
        setActive(true)
        setSampleRate(context.sampleRate)
        setChannels(stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1)
        void refresh(false)
      } catch (reason) {
        if (cancelled) return
        setActive(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }

    void start()
    return () => {
      cancelled = true
      setActive(false)
      setSampleRate(null)
      setChannels(null)
      source?.disconnect()
      worklet?.disconnect()
      silentGain?.disconnect()
      for (const track of stream?.getTracks() ?? []) track.stop()
      if (moduleUrl) URL.revokeObjectURL(moduleUrl)
      if (context) void context.close().catch(() => undefined)
    }
  }, [refresh, selectedInputId])

  return { active, channels, error, options, refresh, sampleRate }
}
