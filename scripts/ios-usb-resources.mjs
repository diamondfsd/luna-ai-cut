import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const projectRoot = resolve(import.meta.dirname, '..')
const requiredFiles = [
  'iproxy.exe',
  'idevice_id.exe',
  'libusbmuxd-2.0.dll',
  'libimobiledevice-1.0.dll',
  'libimobiledevice-glue-1.0.dll',
  'libplist-2.0.dll',
]
const requiredLicenses = [
  'libusbmuxd/COPYING',
  'libimobiledevice/COPYING',
  'libimobiledevice/COPYING.LESSER',
  'libimobiledevice-glue/COPYING',
  'libplist/COPYING',
  'libplist/COPYING.LESSER',
]

export function stageIosUsbResources(
  destination,
  source = join(projectRoot, 'resources', 'ios-usb', 'win-x64'),
) {
  const files = verifyIosUsbResources(source)
  mkdirSync(destination, { recursive: true })
  for (const fileName of files) copyFileSync(join(source, fileName), join(destination, fileName))
  cpSync(join(source, 'licenses'), join(destination, 'licenses'), { recursive: true })
  verifyIosUsbResources(destination)
}

export function verifyIosUsbResources(
  directory,
  checksumFile = join(projectRoot, 'resources', 'ios-usb', 'SHA256SUMS.txt'),
) {
  const checksums = new Map()
  for (const line of readFileSync(checksumFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})\s+win-x64\/([^/]+\.(?:exe|dll))$/i)
    if (!match || checksums.has(match[2])) throw new Error(`iOS USB SHA256 清单格式错误：${line}`)
    checksums.set(match[2], match[1].toLowerCase())
  }
  for (const fileName of requiredFiles) {
    if (!checksums.has(fileName)) throw new Error(`iOS USB SHA256 清单缺少：${fileName}`)
  }
  const runtimeFiles = readdirSync(directory).filter((fileName) => /\.(?:exe|dll)$/i.test(fileName))
  for (const fileName of new Set([...checksums.keys(), ...runtimeFiles])) {
    const expected = checksums.get(fileName)
    if (!expected) throw new Error(`iOS USB 文件未登记：${fileName}`)
    const filePath = join(directory, fileName)
    const data = readFileSync(filePath)
    const actual = createHash('sha256').update(data).digest('hex')
    if (actual !== expected) throw new Error(`iOS USB 文件 SHA256 不匹配：${fileName}`)
    const peOffset = data.length >= 0x40 ? data.readUInt32LE(0x3c) : data.length
    if (data.toString('ascii', 0, 2) !== 'MZ' || peOffset + 6 > data.length
      || data.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
      || data.readUInt16LE(peOffset + 4) !== 0x8664) {
      throw new Error(`iOS USB 文件不是 Windows x64：${fileName}`)
    }
  }
  for (const relativePath of requiredLicenses) {
    const license = readFileSync(join(directory, 'licenses', relativePath), 'utf8').trim()
    if (!license) throw new Error(`iOS USB 许可证为空：${relativePath}`)
  }
  return [...checksums.keys()]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const staging = process.argv[2] === '--stage'
  if (staging && !process.argv[3]) throw new Error('缺少 iOS USB 暂存目录')
  const directory = resolve((staging ? process.argv[3] : process.argv[2]) ?? join(projectRoot, 'resources', 'ios-usb', 'win-x64'))
  if (staging) stageIosUsbResources(directory)
  const files = verifyIosUsbResources(directory)
  console.log(`[ios-usb-check] Windows x64 USB 资源校验通过：${directory} (${files.length} files)`)
}
