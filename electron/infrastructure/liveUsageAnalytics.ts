import { randomUUID } from 'node:crypto'
import type { LiveUsageFeature, LiveUsageProperties } from '../../src/shared/types/liveUsage'
import type { LiveStreamControlCapabilities } from '../../src/shared/types/liveStream'

const FEATURES: LiveUsageFeature[] = ['watermark', 'lut', 'color', 'control']
const CONTROL_TYPES = ['gimbal', 'zoom', 'focus', 'exposure', 'tracking'] as const
export const LIVE_USAGE_INTERVAL_MS = 5 * 60_000

type ControlType = typeof CONTROL_TYPES[number]
type Source = 'console' | 'preview'
type View = { frameRecent: boolean; watermark: boolean; lut: boolean; color: boolean }

interface Session {
  key: string
  id: string
  started: number
  lastSample: number
  lastReport: number
  view: View | null
  sources: Partial<Record<Source, { view: View; timestamp: number }>>
  firstFrame: number | null
  sequence: number
  validMs: number
  opened: Set<LiveUsageFeature>
  changed: Set<LiveUsageFeature>
  used: Set<LiveUsageFeature>
  seconds: Record<'watermark' | 'watermark_user' | 'lut' | 'color', number>
  changes: Record<LiveUsageFeature, number>
  controlReady: boolean
  available: Record<ControlType, boolean | null>
  controls: Record<ControlType, { attempts: number; failures: number; actions: number; last: number }>
}

export function createLiveUsageAnalytics(
  capture: (properties: LiveUsageProperties) => Promise<void>,
  now = () => Date.now(),
) {
  let session: Session | null = null

  function adopt(current: Session) {
    if (!current.view?.frameRecent) return
    for (const feature of ['watermark', 'lut', 'color'] as const) {
      if (current.view[feature] && current.changed.has(feature)) current.used.add(feature)
    }
  }

  function accrue(current: Session, timestamp: number) {
    const elapsed = timestamp - current.lastSample
    if (elapsed >= 0 && elapsed <= 2500 && current.view?.frameRecent) {
      current.validMs += elapsed
      for (const feature of ['watermark', 'lut', 'color'] as const) {
        if (current.view[feature]) current.seconds[feature] += elapsed
      }
      if (current.view.watermark && current.changed.has('watermark')) current.seconds.watermark_user += elapsed
    }
    current.lastSample = timestamp
  }

  function report(current: Session, reason: 'checkpoint' | 'stopped') {
    current.sequence += 1
    const timestamp = now()
    current.lastReport = timestamp
    const properties: LiveUsageProperties = {
      measurement_version: 2,
      app_platform: 'electron_desktop',
      live_session_id: current.id,
      session_started_at: new Date(current.started).toISOString(),
      summary_sequence: current.sequence,
      summary_reason: reason,
      cumulative: true,
      control_available: current.controlReady,
      session_seconds: Math.max(0, Math.round((timestamp - current.started) / 1000)),
      first_frame_rendered: current.firstFrame !== null,
      first_frame_ms: current.firstFrame === null ? null : Math.max(0, current.firstFrame - current.started),
      observed_frame_seconds: Math.round(current.validMs / 1000),
    }
    for (const feature of FEATURES) {
      properties[`${feature}_opened`] = current.opened.has(feature)
      properties[`${feature}_used`] = current.used.has(feature)
      properties[`${feature}_changes`] = current.changes[feature]
    }
    for (const [feature, duration] of Object.entries(current.seconds)) {
      properties[`${feature}_configured_seconds`] = Math.round(duration / 1000)
    }
    for (const type of CONTROL_TYPES) {
      properties[`${type}_available`] = current.available[type]
      properties[`${type}_send_attempts`] = current.controls[type].attempts
      properties[`${type}_send_failures`] = current.controls[type].failures
      properties[`${type}_actions`] = current.controls[type].actions
    }
    void capture(properties).catch(() => undefined)
  }

  return {
    start(key: string) {
      if (session?.key === key) return
      if (session) report(session, 'stopped')
      const timestamp = now()
      session = {
        key, id: randomUUID(), started: timestamp, lastSample: timestamp, lastReport: timestamp,
        view: null, sources: {}, firstFrame: null, sequence: 0, validMs: 0,
        opened: new Set(), changed: new Set(), used: new Set(),
        seconds: { watermark: 0, watermark_user: 0, lut: 0, color: 0 },
        changes: { watermark: 0, lut: 0, color: 0, control: 0 },
        controlReady: false,
        available: { gimbal: null, zoom: null, focus: null, exposure: null, tracking: null },
        controls: Object.fromEntries(CONTROL_TYPES.map(type => [type,
          { attempts: 0, failures: 0, actions: 0, last: -Infinity },
        ])) as Session['controls'],
      }
    },
    message(message: unknown, source: Source = 'console') {
      if (!session || !message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (input.session !== session.key) return
      if (source === 'preview' && input.kind !== 'frame' && input.kind !== 'snapshot') return
      if (input.kind === 'frame') {
        if (session.firstFrame === null) session.firstFrame = now()
      } else if (input.kind === 'snapshot') {
        if (['frameRecent', 'watermark', 'lut', 'color'].some(key => typeof input[key] !== 'boolean')) return
        const timestamp = now()
        accrue(session, timestamp)
        const view: View = {
          frameRecent: input.frameRecent as boolean, watermark: input.watermark as boolean,
          lut: input.lut as boolean, color: input.color as boolean,
        }
        session.sources[source] = { view, timestamp }
        const preview = session.sources.preview
        const console = session.sources.console
        session.view = preview?.view.frameRecent && timestamp - preview.timestamp <= 1500
          ? preview.view
          : console?.view.frameRecent && timestamp - console.timestamp <= 1500 ? console.view : view
        if (session.view.frameRecent && session.firstFrame === null) session.firstFrame = timestamp
        adopt(session)
        if (timestamp - session.lastReport >= LIVE_USAGE_INTERVAL_MS) report(session, 'checkpoint')
      } else if ((input.kind === 'opened' || input.kind === 'changed') && FEATURES.includes(input.feature as LiveUsageFeature)) {
        const feature = input.feature as LiveUsageFeature
        if (input.kind === 'opened') session.opened.add(feature)
        else {
          accrue(session, now())
          session.changed.add(feature)
          session.changes[feature] += 1
        }
      }
    },
    capabilities(key: string, ready: boolean, capabilities: LiveStreamControlCapabilities | null) {
      if (!session || session.key !== key || !ready) return
      session.controlReady = true
      if (!capabilities) return
      const available = {
        gimbal: capabilities.gimbal?.supported, zoom: capabilities.zoom?.supported,
        focus: capabilities.focus?.tap, exposure: capabilities.exposure?.supported,
        tracking: capabilities.tracking?.region,
      }
      for (const type of CONTROL_TYPES) {
        if (typeof available[type] === 'boolean') {
          session.available[type] = session.available[type] === true || available[type] === true
        }
      }
    },
    control(key: string, command: string, failed: boolean) {
      if (!session || session.key !== key || typeof command !== 'string' || command === 'capabilities.get') return
      const type = command.split('.')[0] as ControlType
      if (!CONTROL_TYPES.includes(type)) return
      const counters = session.controls[type]
      if (command.endsWith('.stop')) {
        counters.last = -Infinity
        return
      }
      const timestamp = now()
      counters.attempts += 1
      if (failed) counters.failures += 1
      if (timestamp - counters.last > 1000) counters.actions += 1
      counters.last = timestamp
      if (session.firstFrame !== null) session.used.add('control')
    },
    stop(key: string) {
      if (!session || session.key !== key) return
      accrue(session, now())
      report(session, 'stopped')
      session = null
    },
  }
}

export type LiveUsageAnalytics = ReturnType<typeof createLiveUsageAnalytics>
