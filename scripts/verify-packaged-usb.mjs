import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const builderRequire = createRequire(import.meta.resolve('electron-builder'))
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { listPackage } = libraryRequire('@electron/asar')

export function verifyPackagedUsb(resourcesDir, platform, arch) {
  const archivePath = join(resourcesDir, 'app.asar')
  const normalizeArchivePath = (filePath) => `/${filePath.replaceAll('\\', '/').replace(/^\/+/, '')}`
  const files = new Set(listPackage(archivePath).map(normalizeArchivePath))
  const required = [
    '/node_modules/usb/package.json',
    '/node_modules/usb/dist/usb/bindings.js',
    '/node_modules/node-gyp-build/package.json',
    '/node_modules/node-gyp-build/index.js',
    '/node_modules/node-gyp-build/node-gyp-build.js',
  ]
  const missing = required.filter((filePath) => !files.has(filePath))
  const prebuildDir = platform === 'darwin' ? 'darwin-x64+arm64' : `${platform}-${arch}`
  const nativePath = join('node_modules', 'usb', 'prebuilds', prebuildDir, 'node.napi.node')
  if (!existsSync(join(resourcesDir, 'app.asar.unpacked', nativePath))) missing.push(nativePath)
  if (missing.length > 0) {
    throw new Error(`打包后的 USB 运行依赖不完整：${missing.join(', ')}`)
  }
  console.log(`[package-check] USB 运行依赖校验通过：${platform}-${arch}`)
}
