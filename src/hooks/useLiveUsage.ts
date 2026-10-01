import { useCallback, useEffect, useRef } from 'react'
import type { LiveUsageFeature } from '../shared/types/liveUsage'

interface Options {
  session: string | null
  streaming: boolean
  watermark: boolean
  lut: boolean
  color: boolean
  watermarkSignature: string
  lutSignature: string
  colorSignature: string
}

export function useLiveUsage(options: Options) {
  const current = useRef(options)
  current.current = options
  const lastFrame = useRef(-Infinity)
  const recordFrame = useCallback(() => { lastFrame.current = performance.now() }, [])
  const signatures = useRef<string[] | null>(null)

  useEffect(() => {
    lastFrame.current = -Infinity
    signatures.current = null
    const timer = window.setInterval(() => {
      const view = current.current
      if (!view.session) return
      window.luna.trackLiveUsage({
        kind: 'snapshot', session: view.session,
        frameRecent: view.streaming && performance.now() - lastFrame.current < 1500,
        watermark: view.watermark, lut: view.lut, color: view.color,
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [options.session])

  useEffect(() => {
    const next = [options.watermarkSignature, options.lutSignature, options.colorSignature]
    if (!signatures.current || !options.session) {
      signatures.current = next
      return
    }
    const session = options.session
    const timer = window.setTimeout(() => {
      const features: LiveUsageFeature[] = ['watermark', 'lut', 'color']
      next.forEach((signature, index) => {
        if (signatures.current?.[index] !== signature) {
          window.luna.trackLiveUsage({ kind: 'changed', session, feature: features[index] })
        }
      })
      signatures.current = next
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [options.session, options.watermarkSignature, options.lutSignature, options.colorSignature])

  const opened = useCallback((feature: LiveUsageFeature) => {
    const session = current.current.session
    if (session) window.luna.trackLiveUsage({ kind: 'opened', session, feature })
  }, [])

  return { recordFrame, opened }
}
