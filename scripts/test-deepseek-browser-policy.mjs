import assert from 'node:assert/strict'
import {
  isAllowedBrowserRequestUrl,
  isBlockedBrowserHostname,
  isPrivateIpAddress,
  validateBrowserUrl,
} from '../electron/deepseekBrowserPolicy.ts'

assert.equal(validateBrowserUrl('https://github.com/search?q=electron').hostname, 'github.com')
assert.equal(isPrivateIpAddress('8.8.8.8'), false)
assert.equal(isPrivateIpAddress('127.0.0.1'), true)
assert.equal(isPrivateIpAddress('192.168.1.20'), true)
assert.equal(isPrivateIpAddress('::1'), true)
assert.equal(isPrivateIpAddress('::ffff:10.0.0.1'), true)
assert.equal(isBlockedBrowserHostname('localhost'), true)
assert.equal(isBlockedBrowserHostname('router.local'), true)
assert.equal(isAllowedBrowserRequestUrl('https://github.com'), true)
assert.equal(isAllowedBrowserRequestUrl('file:///etc/hosts'), false)
assert.equal(isAllowedBrowserRequestUrl('http://127.0.0.1:8080'), false)
assert.equal(isAllowedBrowserRequestUrl('http://192.168.1.1'), false)
assert.throws(() => validateBrowserUrl('javascript:alert(1)'), /HTTP 或 HTTPS/u)
assert.throws(() => validateBrowserUrl('https://user:password@example.com'), /登录凭据/u)

console.log('DeepSeek browser URL policy tests passed.')
