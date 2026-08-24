import { readFileSync } from 'node:fs'
import process from 'node:process'

const protocolFiles = [
  'electron/insta360CameraDelete.ts',
  'electron/insta360DeleteCodec.ts',
  'electron/insta360DeviceInfo.ts',
  'electron/insta360TcpCodec.ts',
  'electron/insta360TcpDiagnostics.ts',
  'electron/insta360TcpDiagnosticsCodec.ts',
  'electron/insta360TcpDiagnosticsHttp.ts',
  'electron/insta360TcpDiagnosticsSession.ts',
  'electron/insta360TcpDiagnosticsTypes.ts',
  'electron/insta360TcpFileList.ts',
  'electron/insta360TcpProtocol.ts',
  'electron/lunaControlMessages.ts',
]
const source = (path) => readFileSync(path, 'utf8')
const protocolSource = protocolFiles.map(source).join('\n')
const clientSource = source('electron/lunaProtocol.ts')

for (const signature of [
  'export class Insta360TcpSession',
  'async open()',
  'async sendCommand(',
  'async listFilePaths(',
  'async deleteFilePaths(',
  'export function insta360PacketChecksum(',
  'export function buildDeleteFilesBody(',
  'export function buildKeepAliveOptionsBody(',
  'export async function runInsta360TcpDiagnostics(',
]) {
  if (!protocolSource.includes(signature)) {
    console.error(`Luna protocol source contract missing: ${signature}`)
    process.exit(1)
  }
}

if (!clientSource.includes('session.listFilePaths(cameraPath)')) {
  console.error('LunaClient must read the camera file list through the public TCP protocol source')
  process.exit(1)
}
if (clientSource.includes("from './directHttp'")) {
  console.error('LunaClient must not fall back to HTTP directory listing')
  process.exit(1)
}
if (/gimbal|云台|姿态|摇杆|joystick|yaw|pitch|roll/i.test(protocolSource)) {
  console.error('Luna protocol source must not include gimbal or camera-control protocol')
  process.exit(1)
}

console.log(`Luna protocol source contract verified: ${protocolFiles.length} media files`)
console.log('Luna TCP file-list integration verified')
