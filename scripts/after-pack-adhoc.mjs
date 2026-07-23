import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** electron-builder 生成 DMG 前，对 macOS App 做 Ad Hoc 签名。 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

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
