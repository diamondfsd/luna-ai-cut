import { useCallback, useEffect, useRef } from 'react'
import type { LiveUsageFeature } from '../shared/types/liveUsage'

interface Options {
  observeOnly?: boolean
  session: string | null
  streaming: boolean
  watermark: boolean
  lut: boolean
  color: boolean
  watermarkSignature: string
  lutSignature: string
  colorSignature: string
}

let flushCurrentUsage: (() => void) | null = null

export function flushLiveUsage(): void {
  flushCurrentUsage?.()
}

export function useLiveUsage(options: Options) {
  const current = useRef(options)
  current.current = options
  const lastFrame = useRef(-Infinity)
  const firstFrame = useRef<string | null>(null)
  const recordFrame = useCallback(() => {
    lastFrame.current = performance.now()
    const session = current.current.session
    if (session && firstFrame.current !== session) {
      firstFrame.current = session
      window.luna.trackLiveUsage({ kind: 'frame', session })
    }
  }, [])
  const signatures = useRef<string[] | null>(null)

  const commit = useCallback(() => {
    const view = current.current
    if (!view.session || view.observeOnly) return
    const next = [view.watermarkSignature, view.lutSignature, view.colorSignature]
    const features: LiveUsageFeature[] = ['watermark', 'lut', 'color']
    if (signatures.current) {
      next.forEach((signature, index) => {
        if (signatures.current?.[index] !== signature) {
          window.luna.trackLiveUsage({ kind: 'changed', session: view.session!, feature: features[index] })
        }
      })
    }
    signatures.current = next
  }, [])

  const sendSnapshot = useCallback(() => {
    const view = current.current
    if (!view.session) return
    window.luna.trackLiveUsage({
      kind: 'snapshot', session: view.session,
      frameRecent: view.streaming && performance.now() - lastFrame.current < 1500,
      watermark: view.watermark, lut: view.lut, color: view.color,
    })
  }, [])

  useEffect(() => {
    lastFrame.current = -Infinity
    signatures.current = [current.current.watermarkSignature, current.current.lutSignature, current.current.colorSignature]
    const session = options.session
    const flush = () => {
      if (current.current.session !== session) return
      commit()
      sendSnapshot()
    }
    flushCurrentUsage = flush
    window.addEventListener('beforeunload', flush)
    const timer = window.setInterval(sendSnapshot, 1000)
    return () => {
      flush()
      if (flushCurrentUsage === flush) flushCurrentUsage = null
      window.removeEventListener('beforeunload', flush)
      window.clearInterval(timer)
    }
  }, [options.session, commit, sendSnapshot])

  useEffect(() => {
    if (!options.session) return
    const timer = window.setTimeout(() => {
      commit()
      sendSnapshot()
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [options.session, options.watermarkSignature, options.lutSignature, options.colorSignature, commit, sendSnapshot])

  const opened = useCallback((feature: LiveUsageFeature) => {
    const session = current.current.session
    if (session) window.luna.trackLiveUsage({ kind: 'opened', session, feature })
  }, [])

  return { recordFrame, opened }
}
