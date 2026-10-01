import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verifyPackagedUsb } from './verify-packaged-usb.mjs'

const builderRequire = createRequire(import.meta.resolve('electron-builder'))
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { createPackage, uncache } = libraryRequire('@electron/asar')
const directory = mkdtempSync(join(tmpdir(), 'luna-package-usb-'))
const sourceDir = join(directory, 'source')
const resourcesDir = join(directory, 'resources')
function writeFixture(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '')
}
try {
  mkdirSync(resourcesDir, { recursive: true })
  for (const filePath of ['usb/package.json', 'usb/dist/usb/bindings.js']) {
    writeFixture(join(sourceDir, 'node_modules', filePath))
  }
  await createPackage(sourceDir, join(resourcesDir, 'app.asar'))
  assert.throws(() => verifyPackagedUsb(resourcesDir, 'darwin', 'arm64'), /node-gyp-build/)
  for (const fileName of ['package.json', 'index.js', 'node-gyp-build.js']) {
    writeFixture(join(sourceDir, 'node_modules', 'node-gyp-build', fileName))
  }
  await createPackage(sourceDir, join(resourcesDir, 'app.asar'))
  uncache(join(resourcesDir, 'app.asar'))
  assert.throws(() => verifyPackagedUsb(resourcesDir, 'darwin', 'arm64'), /node.napi.node/)
  for (const prebuild of ['darwin-x64+arm64', 'win32-x64']) {
    writeFixture(join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'usb', 'prebuilds', prebuild, 'node.napi.node'))
  }
  verifyPackagedUsb(resourcesDir, 'darwin', 'arm64')
  verifyPackagedUsb(resourcesDir, 'win32', 'x64')
  assert.throws(() => verifyPackagedUsb(resourcesDir, 'win32', 'arm64'), /win32-arm64/)
  console.log('Packaged USB dependency tests passed')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
