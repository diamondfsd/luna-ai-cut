/**
 * swiftUtils.ts — Swift 脚本路径解析
 *
 * 提供统一的 Swift 脚本路径获取方法，依次查找：
 * 1. 热更新目录（userData/.luna-hot/swift/）
 * 2. 打包资源目录（Resources/swift/）
 * 3. 旧版打包路径（Resources/，兼容 <1.5.0 的 livetool.swift）
 * 4. 开发目录（electron/platform/macos/）
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const HOT_SWIFT_DIR = () => join(app.getPath('userData'), '.luna-hot', 'swift')
const RESOURCES_SWIFT_DIR = () => join(process.resourcesPath, 'swift')
const HOT_NATIVE_DIR = () => join(app.getPath('userData'), '.luna-hot', 'native')
const RESOURCES_NATIVE_DIR = () => join(process.resourcesPath, 'native')
const RESOURCES_LEGACY_DIR = () => process.resourcesPath // 旧版: Resources/livetool.swift
const DEV_SWIFT_DIR = () => join(app.getAppPath(), 'electron', 'platform', 'macos')
const DEV_NATIVE_DIR = () => join(app.getAppPath(), 'electron', 'platform', 'windows')
const DJI_BLE_HELPER_RELATIVE_PATH = join(
  'dji-ble-helper',
  'DjiCoreBluetoothTransport.app',
  'Contents',
  'MacOS',
  'DjiCoreBluetoothTransport',
)

/**
 * 获取 Swift 脚本的完整路径。
 * @param scriptName 脚本文件名，如 "livetool.swift"、"bluetoothCoreScanner.swift"
 */
export function getSwiftScriptPath(scriptName: string): string {
  // 1. 热更新目录（热更新 zip 解压后）
  if (app.isPackaged) {
    const hotPath = join(HOT_SWIFT_DIR(), scriptName)
    if (existsSync(hotPath)) return hotPath
  }

  // 2. 新版打包资源目录（extraResources → Resources/swift/）
  if (app.isPackaged) {
    const resPath = join(RESOURCES_SWIFT_DIR(), scriptName)
    if (existsSync(resPath)) return resPath
  }

  // 3. 旧版打包路径 — 兼容 <1.5.0 安装包（livetool.swift 直接放 Resources/）
  if (app.isPackaged) {
    const legacyPath = join(RESOURCES_LEGACY_DIR(), scriptName)
    if (existsSync(legacyPath)) return legacyPath
  }

  // 4. 开发目录
  return join(DEV_SWIFT_DIR(), scriptName)
}

/** 获取非 Swift 原生 helper（例如 Windows PowerShell BLE bridge）的完整路径。 */
export function getNativeScriptPath(scriptName: string): string {
  if (app.isPackaged) {
    const hotPath = join(HOT_NATIVE_DIR(), scriptName)
    if (existsSync(hotPath)) return hotPath
  }
  if (app.isPackaged) {
    const resourcePath = join(RESOURCES_NATIVE_DIR(), scriptName)
    if (existsSync(resourcePath)) return resourcePath
  }
  return join(DEV_NATIVE_DIR(), scriptName)
}

/** 获取带 macOS 蓝牙权限声明的 DJI CoreBluetooth helper。 */
export function getDjiCoreBluetoothHelperPath(): string {
  if (app.isPackaged) {
    const packagedPath = join(process.resourcesPath, DJI_BLE_HELPER_RELATIVE_PATH)
    if (existsSync(packagedPath)) return packagedPath
  }
  return join(app.getAppPath(), 'resources', DJI_BLE_HELPER_RELATIVE_PATH)
}
