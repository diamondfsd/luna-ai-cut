import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const modulePath = 'vendor/luna-protocol/luna-protocol.cjs'
const checksumPath = 'vendor/luna-protocol/luna-protocol.sha256'
const clientPath = 'electron/lunaProtocol.ts'
const expected = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]
const actual = createHash('sha256').update(readFileSync(modulePath)).digest('hex')

if (!expected || actual !== expected) {
  console.error(`Luna protocol checksum mismatch: expected ${expected || '(empty)'}, received ${actual}`)
  process.exit(1)
}

const importedCore = await import(`../${modulePath}`)
const core = importedCore.default ?? importedCore
if (typeof core.Insta360TcpSession?.prototype?.listFilePaths !== 'function') {
  console.error('Luna protocol bundle is missing Insta360TcpSession.listFilePaths')
  process.exit(1)
}

const clientSource = readFileSync(clientPath, 'utf8')
if (!clientSource.includes('session.listFilePaths(cameraPath)')) {
  console.error('LunaClient must read the camera file list through the TCP protocol')
  process.exit(1)
}
if (clientSource.includes("from './directHttp'")) {
  console.error('LunaClient must not fall back to HTTP directory listing')
  process.exit(1)
}

console.log(`Luna protocol checksum verified: ${actual}`)
console.log('Luna TCP file-list integration verified')
