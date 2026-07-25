import assert from 'node:assert/strict'
import { detectMacArchitecture, isMacBrowser } from '../landing/download-platform.js'

const safariMac = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  platform: 'MacIntel',
}

assert.equal(isMacBrowser(safariMac), true)
assert.deepEqual(
  await detectMacArchitecture(safariMac, 'Apple GPU'),
  { chip: 'arm64', confidence: 'high' },
  'Apple Silicon Safari must not be treated as Intel because of MacIntel',
)
assert.deepEqual(
  await detectMacArchitecture(safariMac, 'Intel(R) Iris(TM) Plus Graphics'),
  { chip: 'x64', confidence: 'high' },
  'An Intel GPU identifies an Intel Mac',
)
assert.deepEqual(
  await detectMacArchitecture(safariMac, ''),
  { chip: 'arm64', confidence: 'recommended' },
  'A privacy-restricted Mac browser should recommend the current Mac default',
)
assert.deepEqual(
  await detectMacArchitecture({
    ...safariMac,
    userAgentData: {
      getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64' }),
    },
  }),
  { chip: 'x64', confidence: 'high' },
  'Browser architecture hints should identify an Intel Mac',
)

console.log('Landing page platform detection tests passed')
