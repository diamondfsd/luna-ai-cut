import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUsageAnalytics } from '../electron/infrastructure/usageAnalytics.ts'

const root = await mkdtemp(join(tmpdir(), 'luna-usage-'))
const events = []
const results = []
const options = {
  enabled: true,
  userData: root,
  appVersion: '1.0.0',
  osName: 'macOS',
  osVersion: '15.0',
  arch: 'arm64',
  environment: 'development',
  onResult: result => results.push(result),
  send: async (url, request) => {
    assert.equal(url, 'https://eu.i.posthog.com/i/v0/e/')
    events.push(JSON.parse(request.body))
    return new Response('{}')
  },
}

try {
  const analytics = createUsageAnalytics(options)
  await Promise.all([analytics.opened(), analytics.pageOpened('/library')])
  await analytics.opened()
  await analytics.pageOpened('/library')
  await analytics.pageOpened('/private-file?path=/Users/example')
  await analytics.pageOpened('__proto__')
  await analytics.pageOpened({ path: '/settings' })
  assert.equal(events.length, 2)
  await analytics.pageOpened('/settings')
  await analytics.pageOpened('/library')
  assert.equal(events.length, 4)
  assert.deepEqual(Object.keys(events[1].properties).sort(), [
    '$geoip_disable', '$process_person_profile', 'app_version', 'arch',
    'distinct_id', 'environment', 'os_name', 'os_version', 'page_name',
  ].sort())
  assert.equal(events[1].properties.page_name, '相机素材')
  const id = events[0].properties.distinct_id
  assert.ok(events.every(event => event.properties.distinct_id === id))
  await createUsageAnalytics(options).opened()
  assert.equal(events.at(-1).properties.distinct_id, id)
  const disabled = createUsageAnalytics({ ...options, enabled: false })
  await disabled.opened()
  await disabled.pageOpened('/settings')
  assert.equal(events.length, 5)
  assert.ok(results.every(result => result.success && result.status === 200))
  await createUsageAnalytics({ ...options, send: async () => new Response('', { status: 403 }) }).opened()
  assert.equal(results.at(-1).success, false)
  assert.equal(results.at(-1).status, 403)
  await createUsageAnalytics({ ...options, send: async () => { throw new Error('offline') } }).opened()
  assert.equal(results.at(-1).success, false)
  assert.equal(results.at(-1).error, 'Error')
  await createUsageAnalytics({ ...options, userData: join(root, 'usage-id', 'invalid') }).opened()
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('usage analytics tests passed')
