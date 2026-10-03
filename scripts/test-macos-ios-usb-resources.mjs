import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { stageMacosIosUsbResources, verifyMacosIosUsbResources } from './macos-ios-usb-resources.mjs'

const temporary = mkdtempSync(join(tmpdir(), 'luna-macos-ios-usb-'))
try {
  for (const arch of ['arm64', 'x64']) {
    const source = resolve(`resources/ios-usb/darwin-${arch}`)
    const staged = join(temporary, arch)
    stageMacosIosUsbResources(staged, arch)
    assert.ok(verifyMacosIosUsbResources(staged, arch).length >= 9)
    writeFileSync(join(staged, 'iproxy'), 'broken')
    assert.throws(() => verifyMacosIosUsbResources(staged, arch), /SHA256/)
    cpSync(source, staged, { recursive: true })
    rmSync(join(staged, 'licenses/libusbmuxd/COPYING'))
    assert.throws(() => verifyMacosIosUsbResources(staged, arch), /COPYING/)
    cpSync(source, staged, { recursive: true })
    rmSync(join(staged, 'licenses/libimobiledevice/source.tar.gz'))
    assert.throws(() => verifyMacosIosUsbResources(staged, arch), /source.tar.gz/)
    cpSync(source, staged, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(staged, 'manifest.json'), 'utf8'))
    delete manifest.files.idevice_id
    writeFileSync(join(staged, 'manifest.json'), JSON.stringify(manifest))
    assert.throws(() => verifyMacosIosUsbResources(staged, arch, join(staged, 'manifest.json')), /清单缺少/)
    cpSync(source, staged, { recursive: true })
    // Execute from a relocated folder with no Homebrew PATH or loader overrides.
    // Intel execution is limited to an Intel host; validate its Mach-O on ARM.
    if (process.platform === 'darwin' && arch === process.arch) {
      const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, TMPDIR: tmpdir() }
      for (const tool of ['iproxy', 'idevice_id', 'idevicepair']) {
        const help = execFileSync(join(staged, tool), ['--help'], { env, encoding: 'utf8' })
        assert.match(help, /usage/i)
      }
    }
  }
  console.log('macOS iOS USB relocation, integrity, architecture and license checks passed')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
