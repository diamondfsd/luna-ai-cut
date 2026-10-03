import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tools = ['iproxy', 'idevice_id', 'idevicepair']
const libraries = ['libusbmuxd-', 'libimobiledevice-', 'libimobiledevice-glue-', 'libplist-', 'libssl.', 'libcrypto.']

export function verifyMacosIosUsbResources(directory, arch, manifestPath = join(root, 'resources', 'ios-usb', `darwin-${arch}`, 'manifest.json')) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`不支持的 iOS USB 架构：${arch}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.platform !== 'darwin' || manifest.arch !== arch || manifest.minimumMacOS !== '12.0') throw new Error('iOS USB manifest 平台不匹配')
  const files = Object.keys(manifest.files)
  for (const tool of tools) if (!files.includes(tool)) throw new Error(`iOS USB 清单缺少：${tool}`)
  for (const library of libraries) if (!files.some((name) => name.startsWith(library) && name.endsWith('.dylib'))) throw new Error(`iOS USB 清单缺少：${library}`)
  const runtimeFiles = readdirSync(directory).filter((name) => name.endsWith('.dylib') || tools.includes(name))
  for (const name of runtimeFiles) if (!files.includes(name)) throw new Error(`iOS USB 文件未登记：${name}`)
  for (const name of files) {
    if (basename(name) !== name) throw new Error('iOS USB 清单路径无效')
    const file = join(directory, name)
    const bytes = readFileSync(file)
    const expected = manifest.files[name]
    if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error(`iOS USB SHA256 不匹配：${name}`)
    const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu) throw new Error(`iOS USB Mach-O 架构不匹配：${name}`)
    if (!(statSync(file).mode & 0o111)) throw new Error(`iOS USB 文件不可执行：${name}`)
    if (process.platform === 'darwin') {
      const dependencies = execFileSync('otool', ['-L', file], { encoding: 'utf8' }).trim().split('\n').slice(1).map((line) => line.trim().split(' (')[0])
      for (const dependency of dependencies) {
        if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')) continue
        if (!dependency.startsWith('@loader_path/') || !files.includes(dependency.slice('@loader_path/'.length))) throw new Error(`iOS USB 非独立依赖：${name}: ${dependency}`)
      }
      const commands = execFileSync('otool', ['-l', file], { encoding: 'utf8' })
      const minimum = commands.match(/\bminos\s+(\d+)\.(\d+)/) ?? commands.match(/cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+)\.(\d+)/)
      if (!minimum || Number(minimum[1]) > 12 || (Number(minimum[1]) === 12 && Number(minimum[2]) > 0)) throw new Error(`iOS USB 最低系统版本不兼容：${name}`)
    }
  }
  for (const source of manifest.sources) {
    const licenseDirectory = join(directory, 'licenses', source.name)
    const licenseName = source.name === 'openssl' ? 'LICENSE.txt' : 'COPYING'
    if (!readFileSync(join(licenseDirectory, licenseName), 'utf8').trim()) throw new Error(`iOS USB 许可证为空：${source.name}`)
    if (source.name !== 'openssl' && !statSync(join(licenseDirectory, 'source.tar.gz')).size) throw new Error(`iOS USB 源代码缺失：${source.name}`)
  }
  for (const [name, expected] of Object.entries(manifest.licenseFiles ?? {})) {
    if (name.split(/[\\/]/).some((part) => part === '..') || name.startsWith('/')) throw new Error('iOS USB 许可路径无效')
    if (createHash('sha256').update(readFileSync(join(directory, 'licenses', name))).digest('hex') !== expected) throw new Error(`iOS USB 许可 SHA256 不匹配：${name}`)
  }
  return files
}

export function stageMacosIosUsbResources(destination, arch) {
  const source = join(root, 'resources', 'ios-usb', `darwin-${arch}`)
  const files = verifyMacosIosUsbResources(source, arch)
  cpSync(source, destination, { recursive: true })
  for (const name of files) chmodSync(join(destination, name), 0o755)
  verifyMacosIosUsbResources(destination, arch)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  for (const arch of ['arm64', 'x64']) {
    const files = verifyMacosIosUsbResources(join(root, 'resources', 'ios-usb', `darwin-${arch}`), arch)
    console.log(`[ios-usb-check] macOS ${arch}: ${files.length} files`)
  }
}
