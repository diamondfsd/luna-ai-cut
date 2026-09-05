/**
 * swiftUtils.ts — macOS 原生 helper 路径解析
 *
 * 原生 helper 在构建阶段由 Swift 编译，运行时只执行已编译的二进制。
 * 查找顺序：
 * 1. 热更新目录（userData/.luna-hot/macos-native/）
 * 2. 打包资源目录（Resources/macos-native/）
 * 3. 开发目录（resources/macos-native/）
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const HOT_MACOS_NATIVE_DIR = () => join(app.getPath('userData'), '.luna-hot', 'macos-native')
const RESOURCES_MACOS_NATIVE_DIR = () => join(process.resourcesPath, 'macos-native')
const DEV_MACOS_NATIVE_DIR = () => join(app.getAppPath(), 'resources', 'macos-native')
const HOT_NATIVE_DIR = () => join(app.getPath('userData'), '.luna-hot', 'native')
const RESOURCES_NATIVE_DIR = () => join(process.resourcesPath, 'native')
const DEV_NATIVE_DIR = () => join(app.getAppPath(), 'electron', 'platform', 'windows')

/**
 * 获取已编译 macOS helper 的完整路径。
 * @param helperName helper 名称，如 "livetool"、"bluetoothCoreScanner"
 */
export function getMacosHelperPath(helperName: string): string {
  // 1. 热更新目录（热更新 zip 解压后）
  if (app.isPackaged) {
    const hotPath = join(HOT_MACOS_NATIVE_DIR(), helperName)
    if (existsSync(hotPath)) return hotPath
  }

  // 2. 安装包资源目录（extraResources → Resources/macos-native/）
  if (app.isPackaged) {
    const resPath = join(RESOURCES_MACOS_NATIVE_DIR(), helperName)
    if (existsSync(resPath)) return resPath
  }

  // 3. 开发目录。构建脚本会在这里生成可执行文件。
  return join(DEV_MACOS_NATIVE_DIR(), helperName)
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
