import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const modulePath = 'vendor/luna-protocol/luna-protocol.cjs'
const checksumPath = 'vendor/luna-protocol/luna-protocol.sha256'
const expected = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]
const actual = createHash('sha256').update(readFileSync(modulePath)).digest('hex')

if (!expected || actual !== expected) {
  console.error(`Luna protocol checksum mismatch: expected ${expected || '(empty)'}, received ${actual}`)
  process.exit(1)
}

console.log(`Luna protocol checksum verified: ${actual}`)
