import assert from 'node:assert/strict'
import { withDeepSeekHarnessDefaults } from '../electron/deepseekHarnessDefaults.ts'

const defaults = withDeepSeekHarnessDefaults({ 'ui-theme': { preference: 'dark' } })
assert.deepEqual(defaults.locale, { preference: 'zh' })
assert.deepEqual(defaults.permission, { defaultPreset: 'workspace-write' })
assert.deepEqual(defaults['ui-theme'], { preference: 'dark' })

const explicit = withDeepSeekHarnessDefaults({
  locale: { preference: 'en', custom: true },
  permission: { defaultPreset: 'read-only', custom: true },
})
assert.deepEqual(explicit.locale, { preference: 'en', custom: true })
assert.deepEqual(explicit.permission, { defaultPreset: 'read-only', custom: true })

const original = { locale: { preference: 'invalid' } }
withDeepSeekHarnessDefaults(original)
assert.deepEqual(original, { locale: { preference: 'invalid' } })

console.log('DeepSeek Harness Luna defaults passed.')
