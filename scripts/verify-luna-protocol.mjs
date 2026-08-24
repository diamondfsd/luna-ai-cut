import { readFileSync } from 'node:fs'
import process from 'node:process'

const protocolFiles = [
  'electron/devices/insta360/insta360CameraDelete.ts',
  'electron/devices/insta360/insta360DeleteCodec.ts',
  'electron/devices/insta360/insta360DeviceInfo.ts',
  'electron/devices/insta360/insta360TcpCodec.ts',
  'electron/devices/insta360/insta360TcpDiagnostics.ts',
  'electron/devices/insta360/insta360TcpDiagnosticsCodec.ts',
  'electron/devices/insta360/insta360TcpDiagnosticsHttp.ts',
  'electron/devices/insta360/insta360TcpDiagnosticsSession.ts',
  'electron/devices/insta360/insta360TcpDiagnosticsTypes.ts',
  'electron/devices/insta360/insta360TcpFileList.ts',
  'electron/devices/insta360/insta360TcpProtocol.ts',
  'electron/devices/insta360/lunaControlMessages.ts',
]
const source = (path) => readFileSync(path, 'utf8')
const protocolSource = protocolFiles.map(source).join('\n')
const clientSource = source('electron/devices/insta360/lunaProtocol.ts')

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
