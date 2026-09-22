#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const macOSDir = join(root, 'desktop_virtual_camera', 'macos')
const outputDir = join(root, 'resources', 'desktop-virtual-camera')
const builtApp = join(macOSDir, '.build', 'SignedData', 'Build', 'Products', 'Debug', 'LunaCameraHost.app')
const bundledApp = join(outputDir, 'LunaCameraHost.app')
const builtMicrophone = join(macOSDir, '.build', 'LunaVirtualMicrophone.driver')
const bundledMicrophone = join(outputDir, 'LunaVirtualMicrophone.driver')
const microphoneNotice = join(macOSDir, 'VirtualMicrophone', 'ThirdPartyNotices.md')
const bundledMicrophoneNotice = join(outputDir, 'LunaVirtualMicrophone.THIRD_PARTY_NOTICES.md')
const teamId = process.env.LUNA_DESKTOP_CAMERA_TEAM_ID || process.env.DEVELOPMENT_TEAM

if (process.platform !== 'darwin') {
  throw new Error('desktop virtual camera 只能在 macOS 上构建')
}
if (!teamId) {
  throw new Error('缺少 LUNA_DESKTOP_CAMERA_TEAM_ID 或 DEVELOPMENT_TEAM，无法生成 System Extension provisioning profile')
}

execFileSync(join(macOSDir, 'tools', 'build-macos-camera.sh'), [], {
  cwd: macOSDir,
  env: {
    ...process.env,
    DEVELOPMENT_TEAM: teamId,
    CODE_SIGN_IDENTITY: process.env.CODE_SIGN_IDENTITY || 'Apple Development',
  },
  stdio: 'inherit',
})

if (!existsSync(builtApp)) throw new Error(`签名构建未生成：${builtApp}`)
if (!existsSync(builtMicrophone)) throw new Error(`虚拟麦克风构建未生成：${builtMicrophone}`)
rmSync(bundledApp, { recursive: true, force: true })
rmSync(bundledMicrophone, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })
execFileSync('/usr/bin/ditto', [builtApp, bundledApp], { stdio: 'inherit' })
execFileSync('/usr/bin/ditto', [builtMicrophone, bundledMicrophone], { stdio: 'inherit' })
copyFileSync(microphoneNotice, bundledMicrophoneNotice)
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundledApp], { stdio: 'inherit' })
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundledMicrophone], { stdio: 'inherit' })

console.log(`[desktop-camera] 已复制签名 Host：${bundledApp}`)
console.log(`[desktop-camera] 已复制签名虚拟麦克风：${bundledMicrophone}`)
