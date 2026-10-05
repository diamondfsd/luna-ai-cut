import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { verifyIosUsbResources } from './ios-usb-resources.mjs'
import { verifyMacosIosUsbResources } from './macos-ios-usb-resources.mjs'
import { verifyPackagedUsb } from './verify-packaged-usb.mjs'

/** electron-builder 生成 DMG 前，对 macOS App 做 Ad Hoc 签名。 */
export default async function afterPack(context) {
  const appName = `${context.packager.appInfo.productFilename}.app`
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'win32') {
    const resourcesDir = context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, appName, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
    verifyPackagedUsb(resourcesDir, context.electronPlatformName, context.arch === 3 ? 'arm64' : context.arch === 0 ? 'ia32' : 'x64')
  }
  if (context.electronPlatformName === 'win32') {
    verifyWindowsRuntimeLayout(context.appOutDir)
    verifyIosUsbResources(
      join(context.appOutDir, 'resources', 'ios-usb'),
      join(context.packager.projectDir, 'resources', 'ios-usb', 'SHA256SUMS.txt'),
    )
    return
  }
  if (context.electronPlatformName !== 'darwin') return
  verifyMacosIosUsbResources(join(context.appOutDir, appName, 'Contents', 'Resources', 'ios-usb'), context.arch === 3 ? 'arm64' : 'x64')
  if (process.env.LUNA_SIGNING_MODE === 'official') {
    console.log('[after-pack] 正式签名模式，交由 electron-builder 完成签名')
    return
  }

  const appPath = join(context.appOutDir, appName)
  const entitlementsPath = join(context.packager.projectDir, 'build', 'entitlements.mac.plist')
  if (!existsSync(appPath)) throw new Error(`Ad Hoc 签名目标不存在：${appPath}`)

  const helperDir = join(appPath, 'Contents', 'Resources', 'macos-native')
  const helperNames = ['bluetoothCoreScanner', 'wifiCoreWlan', 'livetool']
  for (const helperName of helperNames) {
    const helperPath = join(helperDir, helperName)
    if (!existsSync(helperPath)) throw new Error(`macOS helper 不存在：${helperPath}`)
    execFileSync('codesign', [
      '--force',
      '--verbose',
      '--sign',
      '-',
      '--entitlements',
      entitlementsPath,
      helperPath,
    ], { stdio: 'inherit' })
  }

  const iosDir = join(appPath, 'Contents', 'Resources', 'ios-usb')
  for (const name of readdirSync(iosDir).filter((name) => name.endsWith('.dylib') || ['iproxy', 'idevice_id', 'idevicepair'].includes(name))) {
    execFileSync('codesign', ['--force', '--sign', '-', join(iosDir, name)], { stdio: 'inherit' })
  }

  const hdcDir = join(appPath, 'Contents', 'Resources', 'harmony-hdc')
  for (const name of ['libusb_shared.dylib', 'hdc']) {
    const binary = join(hdcDir, name)
    if (existsSync(binary)) execFileSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' })
  }

  execFileSync('codesign', [
    '--deep',
    '--force',
    '--verbose',
    '--sign',
    '-',
    '--entitlements',
    entitlementsPath,
    appPath,
  ], { stdio: 'inherit' })

  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })
  console.log(`[after-pack] Ad Hoc 签名完成：${appPath}`)
}

function verifyWindowsRuntimeLayout(appOutDir) {
  const resourcesDir = join(appOutDir, 'resources')
  const ffmpegDir = join(resourcesDir, 'ffmpeg')
  const nativeDir = join(resourcesDir, 'luna-render-core')
  const required = [
    'ffmpeg.exe',
    'ffprobe.exe',
    'avcodec-62.dll',
    'avdevice-62.dll',
    'avfilter-11.dll',
    'avformat-62.dll',
    'avutil-60.dll',
    'swresample-6.dll',
    'swscale-9.dll',
  ]
  const missing = required.filter((fileName) => !existsSync(join(ffmpegDir, fileName)))
  if (missing.length > 0) {
    throw new Error(`Windows FFmpeg 运行库不完整：缺少 ${missing.join(', ')}`)
  }

  const ffmpegDllPattern = /^(?:avcodec|avdevice|avfilter|avformat|avutil|postproc|swresample|swscale)-\d+\.dll$/i
  const duplicated = readdirSync(nativeDir).filter((fileName) => ffmpegDllPattern.test(fileName))
  if (duplicated.length > 0) {
    throw new Error(`Windows FFmpeg 运行库被重复打包：${duplicated.join(', ')}`)
  }
  console.log(`[after-pack] Windows FFmpeg 运行库已统一：${ffmpegDir}`)
}
