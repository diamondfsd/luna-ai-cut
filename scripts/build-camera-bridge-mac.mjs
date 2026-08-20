import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.log('[camera-bridge] macOS native camera service skipped on this platform')
  process.exit(0)
}

const root = process.cwd()
const sourceDir = join(root, 'native', 'macos', 'LunaCameraExtension')
const outputDir = join(sourceDir, 'build')
const bundleDir = join(outputDir, 'LunaCameraExtension.app')
const contentsDir = join(bundleDir, 'Contents')
const executableDir = join(contentsDir, 'MacOS')
const output = join(executableDir, 'LunaCameraExtension')
const hostBundleDir = join(outputDir, 'LunaCameraDevHost.app')
const hostContentsDir = join(hostBundleDir, 'Contents')
const hostExecutableDir = join(hostContentsDir, 'MacOS')
const hostOutput = join(hostExecutableDir, 'LunaCameraDevHost')
const systemExtensionDir = join(hostContentsDir, 'Library', 'SystemExtensions', 'com.diamondfsd.lunaaicut.camera.systemextension')
const systemExtensionContentsDir = join(systemExtensionDir, 'Contents')
const systemExtensionExecutableDir = join(systemExtensionContentsDir, 'MacOS')
const installedHostBundleDir = '/Applications/Luna Camera Development Host.app'
const extensionEntitlements = join(sourceDir, 'CameraExtension.entitlements')
const hostEntitlements = join(sourceDir, 'DevHost.entitlements')
const sources = [
  'FrameServer.swift',
  'H264Decoder.swift',
  'CameraExtensionProvider.swift',
  'main.swift',
].map((file) => join(sourceDir, file))

if (!sources.every((file) => existsSync(file))) {
  console.error('[camera-bridge] macOS native source files are missing')
  process.exit(1)
}

mkdirSync(executableDir, { recursive: true })
copyFileSync(join(sourceDir, 'Info.plist'), join(contentsDir, 'Info.plist'))
const result = spawnSync('swiftc', [
  '-O',
  '-framework', 'Foundation',
  '-framework', 'CoreMedia',
  '-framework', 'CoreMediaIO',
  '-framework', 'VideoToolbox',
  '-framework', 'IOKit',
  '-o', output,
  ...sources,
], { cwd: root, stdio: 'inherit' })

if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync(systemExtensionExecutableDir, { recursive: true })
copyFileSync(output, join(systemExtensionExecutableDir, 'LunaCameraExtension'))
copyFileSync(join(sourceDir, 'Info.plist'), join(systemExtensionContentsDir, 'Info.plist'))
mkdirSync(hostExecutableDir, { recursive: true })
copyFileSync(join(sourceDir, 'DevHostInfo.plist'), join(hostContentsDir, 'Info.plist'))
const installer = spawnSync('swiftc', [
  '-O',
  '-framework', 'Foundation',
  '-framework', 'SystemExtensions',
  '-o', hostOutput,
  join(sourceDir, 'Installer.swift'),
], { cwd: root, stdio: 'inherit' })
if (installer.status !== 0) process.exit(installer.status ?? 1)
const signingIdentity = resolveSigningIdentity()
const extensionSign = spawnSync('codesign', [
  '--force',
  '--sign', signingIdentity,
  '--entitlements', extensionEntitlements,
  systemExtensionDir,
], { cwd: root, stdio: 'inherit' })
if (extensionSign.status !== 0) process.exit(extensionSign.status ?? 1)
const hostSign = spawnSync('codesign', [
  '--force',
  '--sign', signingIdentity,
  '--entitlements', hostEntitlements,
  hostBundleDir,
], { cwd: root, stdio: 'inherit' })
if (hostSign.status !== 0) process.exit(hostSign.status ?? 1)
cpSync(hostBundleDir, installedHostBundleDir, { recursive: true, force: true })
console.log(`[camera-bridge] development host installed: ${installedHostBundleDir}`)
console.log(`[camera-bridge] signing identity: ${signingIdentity}`)
console.log(`[camera-bridge] macOS native service built: ${output}`)

function resolveSigningIdentity() {
  if (process.env.LUNA_CAMERA_CODESIGN_IDENTITY) return process.env.LUNA_CAMERA_CODESIGN_IDENTITY
  const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  const match = identities.stdout.match(/"(Apple Development:[^"]+)"/)
  if (match) return match[1]
  console.warn('[camera-bridge] Apple Development identity not found; falling back to ad hoc signing')
  return '-'
}
