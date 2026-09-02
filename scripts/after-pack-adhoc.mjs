import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** electron-builder 生成 DMG 前，对 macOS App 做 Ad Hoc 签名。 */
export default async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    verifyWindowsRuntimeLayout(context.appOutDir)
    return
  }
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.LUNA_SIGNING_MODE === 'official') {
    console.log('[after-pack] 正式签名模式，交由 electron-builder 完成签名')
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)
  const entitlementsPath = join(context.packager.projectDir, 'build', 'entitlements.mac.plist')
  if (!existsSync(appPath)) throw new Error(`Ad Hoc 签名目标不存在：${appPath}`)

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
