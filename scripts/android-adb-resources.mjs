import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const manifestPath = join(root, 'resources/android-adb/manifest.json')
const source = join(root, 'resources/android-adb/win-x64')

export function verifyAndroidAdbResources(directory = source) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const names = Object.keys(manifest.files)
  const required = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt']
  if (names.length !== required.length || required.some((name) => !names.includes(name))) throw new Error('ADB 最小资源清单不完整')
  for (const name of readdirSync(directory)) {
    if (!names.includes(name) && name !== 'manifest.json') throw new Error(`ADB 资源未登记：${name}`)
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = readFileSync(join(directory, name))
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`ADB SHA256 不匹配：${name}`)
    if (/\.(exe|dll)$/i.test(name)) {
      const offset = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : bytes.length
      if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset + 6 > bytes.length
        || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0'
        || bytes.readUInt16LE(offset + 4) !== manifest.peMachine) throw new Error(`ADB 架构错误：${name}`)
    }
  }
  if (manifest.version !== '37.0.1' || !readFileSync(join(directory, 'NOTICE.txt'), 'utf8').includes('Apache License')) {
    throw new Error('ADB 版本或许可证信息无效')
  }
  return names
}

export function stageAndroidAdbResources(destination) {
  const names = verifyAndroidAdbResources()
  mkdirSync(destination, { recursive: true })
  for (const name of names) copyFileSync(join(source, name), join(destination, name))
  copyFileSync(manifestPath, join(destination, 'manifest.json'))
  verifyAndroidAdbResources(destination)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Windows ADB 最小资源校验通过：${verifyAndroidAdbResources().join(', ')}`)
}
