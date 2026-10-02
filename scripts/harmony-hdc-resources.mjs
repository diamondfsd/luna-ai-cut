import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
export function hdcResourceDirectory(target, arch) {
  return join(root, 'resources/harmony-hdc', `${target}-${arch}`)
}
export function verifyHarmonyHdcResources(directory = hdcResourceDirectory('darwin', 'arm64')) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
  const names = manifest.files.map(entry => entry.file)
  const windows = manifest.platform === 'Windows x64'
  const required = windows ? ['hdc.exe', 'libusb_shared.dll'] : ['hdc', 'libusb_shared.dylib']
  if ((!windows && (manifest.version !== '3.2.0f' || manifest.platform !== 'macOS arm64'))
    || names.length !== required.length || required.some(name => !names.includes(name))) {
    throw new Error('HDC 最小资源清单或平台无效')
  }
  const allowed = [...names, 'manifest.json', 'README.md', ...(windows ? ['NOTICE.txt'] : [])]
  for (const name of allowed) if (!existsSync(join(directory, name))) throw new Error(`HDC 缺少资源：${name}`)
  if (readdirSync(directory).some(name => !allowed.includes(name))) throw new Error('HDC 存在未登记资源')
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(directory, entry.file))
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new Error(`HDC SHA256 校验失败：${entry.file}`)
    }
    if (windows) {
      const offset = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : bytes.length
      if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset + 6 > bytes.length
        || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0'
        || bytes.readUInt16LE(offset + 4) !== 0x8664) throw new Error(`HDC 架构错误：${entry.file}`)
    } else if (bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c) {
      throw new Error(`HDC 架构错误：${entry.file}`)
    }
  }
  return allowed
}
export function stageHarmonyHdcResources(destination, target, arch) {
  mkdirSync(destination, { recursive: true })
  const source = hdcResourceDirectory(target, arch)
  // Unprovided platforms get an empty directory, never an incompatible binary.
  if (!existsSync(source)) return false
  for (const name of verifyHarmonyHdcResources(source)) copyFileSync(join(source, name), join(destination, name))
  if (target === 'darwin') chmodSync(join(destination, 'hdc'), 0o755)
  verifyHarmonyHdcResources(destination)
  return true
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [target, arch] of [['darwin', 'arm64'], ['win32', 'x64']]) {
    console.log(`${target}-${arch} HDC 校验通过：${verifyHarmonyHdcResources(hdcResourceDirectory(target, arch)).join(', ')}`)
  }
}
