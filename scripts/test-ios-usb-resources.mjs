import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stageIosUsbResources, verifyIosUsbResources } from './ios-usb-resources.mjs'

const source = resolve('resources/ios-usb/win-x64')
const root = mkdtempSync(join(tmpdir(), 'luna-ios-usb-resources-'))
try {
  assert.equal(verifyIosUsbResources(source).length, 6)
  const staged = join(root, 'staged')
  stageIosUsbResources(staged, source)
  assert.equal(verifyIosUsbResources(staged).length, 6)
  const copy = (name) => {
    const directory = join(root, name)
    cpSync(source, directory, { recursive: true })
    return directory
  }
  const missingDll = copy('missing-dll')
  rmSync(join(missingDll, 'libplist-2.0.dll'))
  assert.throws(() => verifyIosUsbResources(missingDll), /libplist-2\.0\.dll/)
  const damaged = copy('damaged')
  writeFileSync(join(damaged, 'iproxy.exe'), 'damaged')
  assert.throws(() => verifyIosUsbResources(damaged), /SHA256 不匹配/)
  stageIosUsbResources(damaged, source)
  assert.equal(verifyIosUsbResources(damaged).length, 6)
  const unknown = copy('unknown')
  writeFileSync(join(unknown, 'unknown.dll'), 'unknown')
  assert.throws(() => verifyIosUsbResources(unknown), /未登记/)
  const noLicense = copy('missing-license')
  rmSync(join(noLicense, 'licenses/libusbmuxd/COPYING'))
  assert.throws(() => verifyIosUsbResources(noLicense), /COPYING/)
  const noLibraryLicense = copy('missing-library-license')
  rmSync(join(noLibraryLicense, 'licenses/libplist/COPYING.LESSER'))
  assert.throws(() => verifyIosUsbResources(noLibraryLicense), /COPYING\.LESSER/)
  const checksumFile = join(root, 'missing-checksum.txt')
  const sums = readFileSync(resolve('resources/ios-usb/SHA256SUMS.txt'), 'utf8')
  writeFileSync(checksumFile, sums.split(/\r?\n/).filter((line) => !line.endsWith('libplist-2.0.dll')).join('\n'))
  assert.throws(() => verifyIosUsbResources(source, checksumFile), /清单缺少/)
  console.log('Windows iOS USB runtime completeness, integrity and license checks passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
