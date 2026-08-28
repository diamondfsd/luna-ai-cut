#!/usr/bin/env node

import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = join(import.meta.dirname, '..')
const crossTarget = process.env.CROSS_TARGET?.toLowerCase() ?? ''
const isMacBuild = process.platform === 'darwin' || crossTarget.includes('apple-darwin')

if (!isMacBuild) {
  console.log('[build-dji-ble-helper] 当前目标不是 macOS，跳过')
  process.exit(0)
}

const sourcePath = join(root, 'electron', 'platform', 'macos', 'djiCoreBluetoothTransport.swift')
const plistPath = join(root, 'electron', 'platform', 'macos', 'djiCoreBluetoothTransport-Info.plist')
const appDir = join(root, 'resources', 'dji-ble-helper', 'DjiCoreBluetoothTransport.app')
const contentsDir = join(appDir, 'Contents')
const macosDir = join(contentsDir, 'MacOS')
const executablePath = join(macosDir, 'DjiCoreBluetoothTransport')

mkdirSync(macosDir, { recursive: true })

const target = crossTarget.includes('x86_64')
  ? 'x86_64-apple-macos13.0'
  : crossTarget.includes('aarch64')
    ? 'arm64-apple-macos13.0'
    : null
const swiftArgs = ['-O', '-framework', 'Foundation', '-framework', 'CoreBluetooth']
if (target) swiftArgs.push('-target', target)
swiftArgs.push('-o', executablePath, sourcePath)

console.log('[build-dji-ble-helper] swiftc', target ?? process.arch)
const result = spawnSync('swiftc', swiftArgs, { cwd: root, stdio: 'inherit' })
if (result.status !== 0) {
  console.error('[build-dji-ble-helper] Swift helper 构建失败')
  process.exit(result.status ?? 1)
}

copyFileSync(plistPath, join(contentsDir, 'Info.plist'))
chmodSync(executablePath, 0o755)
console.log(`[build-dji-ble-helper] 已生成 ${appDir}`)
