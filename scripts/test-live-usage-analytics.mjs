import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLiveUsageAnalytics, LIVE_USAGE_INTERVAL_MS } from '../electron/infrastructure/liveUsageAnalytics.ts'
import { createLiveUsageBudget, LIVE_USAGE_DAILY_LIMIT } from '../electron/infrastructure/liveUsageBudget.ts'
import { createUsageAnalytics } from '../electron/infrastructure/usageAnalytics.ts'

const root = await mkdtemp(join(tmpdir(), 'luna-live-usage-'))
let timestamp = Date.parse('2026-10-01T00:00:00Z')
const clock = () => timestamp

try {
  const budgetDirectory = join(root, 'budget')
  const budget = createLiveUsageBudget(budgetDirectory, clock)
  for (let index = 0; index < LIVE_USAGE_DAILY_LIMIT; index += 1) assert.equal(budget.reserve(), true)
  assert.equal(budget.reserve(), false)
  assert.equal(createLiveUsageBudget(budgetDirectory, clock).reserve(), false)
  timestamp += 86_400_000
  assert.equal(budget.reserve(), true)
  timestamp -= 86_400_000
  assert.equal(budget.reserve(), false)
  await writeFile(join(budgetDirectory, 'live-usage-budget.json'), '{broken')
  assert.equal(createLiveUsageBudget(budgetDirectory, clock).reserve(), false)

  const reports = []
  const tracker = createLiveUsageAnalytics(async properties => { reports.push(properties) }, clock)
  const snapshot = (session, overrides = {}) => tracker.message({
    kind: 'snapshot', session, frameRecent: true, watermark: true, lut: false, color: false,
    ...overrides,
  })
  tracker.start('first')
  tracker.start('first')
  snapshot('first')
  for (let index = 0; index < 4; index += 1) {
    timestamp += 1000
    snapshot('first')
  }
  tracker.message({ kind: 'opened', session: 'first', feature: 'watermark', path: '/private/file' })
  tracker.message({ kind: 'changed', session: 'stale', feature: 'watermark' })
  tracker.message({ kind: 'changed', session: 'first', feature: '__proto__' })
  tracker.stop('stale')
  assert.equal(reports.length, 0)
  tracker.stop('first')
  assert.equal(reports.length, 1)
  assert.equal(reports[0].watermark_used, false)
  assert.equal(reports[0].watermark_opened, true)
  assert.equal(reports[0].watermark_configured_seconds, 4)
  assert.equal(reports[0].watermark_user_configured_seconds, 0)
  assert.ok(!JSON.stringify(reports).includes('/private/file'))
  tracker.stop('first')
  assert.equal(reports.length, 1)

  tracker.start('second')
  snapshot('second', { frameRecent: false })
  tracker.message({ kind: 'changed', session: 'second', feature: 'lut' })
  tracker.message({ kind: 'changed', session: 'second', feature: 'watermark' })
  timestamp += 1000
  snapshot('second', { lut: true })
  tracker.control('second', 'gimbal.move', false)
  tracker.control('second', 'gimbal.move', true)
  tracker.control('second', 'gimbal.stop', false)
  tracker.control('second', 'gimbal.move', false)
  tracker.control('stale', 'focus.tap', false)
  tracker.control('second', 'capabilities.get', false)
  timestamp += 1000
  snapshot('second', { lut: true })
  timestamp += LIVE_USAGE_INTERVAL_MS
  snapshot('second', { frameRecent: false, lut: true })
  assert.equal(reports.length, 2)
  const checkpoint = reports.at(-1)
  assert.equal(checkpoint.summary_reason, 'checkpoint')
  assert.equal(checkpoint.lut_used, true)
  assert.equal(checkpoint.watermark_used, true)
  assert.equal(checkpoint.observed_frame_seconds, 1)
  assert.equal(checkpoint.gimbal_send_attempts, 3)
  assert.equal(checkpoint.gimbal_send_failures, 1)
  assert.equal(checkpoint.gimbal_actions, 2)
  tracker.stop('second')
  const final = reports.at(-1)
  assert.equal(final.live_session_id, checkpoint.live_session_id)
  assert.equal(final.summary_sequence, 2)
  assert.equal(final.observed_frame_seconds, checkpoint.observed_frame_seconds)
  assert.equal(final.cumulative, true)

  tracker.start('no-frame')
  tracker.message({ kind: 'changed', session: 'no-frame', feature: 'color' })
  tracker.message({ kind: 'snapshot', session: 'no-frame', frameRecent: 'yes', watermark: true, lut: false, color: true })
  timestamp += 500
  tracker.stop('no-frame')
  assert.equal(reports.at(-1).first_frame_rendered, false)
  assert.equal(reports.at(-1).color_used, false)
  assert.equal(reports.at(-1).first_frame_ms, null)

  let sent = 0
  const properties = []
  const options = {
    enabled: true, userData: join(root, 'sender'), appVersion: 'test', osName: 'test',
    osVersion: 'test', arch: 'test', environment: 'development',
    send: async (_url, request) => {
      sent += 1
      properties.push(JSON.parse(request.body))
      throw new Error('offline')
    },
  }
  const analytics = createUsageAnalytics(options)
  for (let index = 0; index < 100; index += 1) await analytics.liveSummary(final)
  assert.equal(sent, LIVE_USAGE_DAILY_LIMIT)
  await createUsageAnalytics(options).liveSummary(final)
  assert.equal(sent, LIVE_USAGE_DAILY_LIMIT)
  await analytics.opened()
  assert.equal(sent, LIVE_USAGE_DAILY_LIMIT + 1)
  assert.equal(properties[0].event, 'live_usage_summary')
  assert.equal(properties[0].properties.$process_person_profile, false)
  assert.ok(properties.every(event => event.properties.distinct_id === properties[0].properties.distinct_id))
  await createUsageAnalytics({ ...options, enabled: false }).liveSummary(final)
  assert.equal(sent, LIVE_USAGE_DAILY_LIMIT + 1)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('live usage analytics tests passed')
