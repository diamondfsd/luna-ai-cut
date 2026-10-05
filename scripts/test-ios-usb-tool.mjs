import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const temporary = mkdtempSync(join(tmpdir(), 'luna-ios-usb-tool-'))
const previous = process.env.USB_VIDEO_IPROXY_BIN
try {
  for (const [platform, developmentMode] of [['darwin', true], ['win32', true], ['darwin', false], ['win32', false]]) {
    const result = await build({
      entryPoints: ['electron/media/live-stream/iosUsbTool.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
      define: { 'process.platform': JSON.stringify(platform), 'process.arch': '"arm64"', 'process.resourcesPath': '"/installed/Resources"', 'process.defaultApp': String(developmentMode) },
      plugins: [{ name: 'tool-files', setup(builder) {
        builder.onResolve({ filter: /^node:fs$/ }, () => ({ path: 'fs', namespace: 'test' }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const existsSync = (path) => globalThis.__iosToolFiles.has(path);' }))
      } }],
    })
    const bundle = join(temporary, `${platform}-${developmentMode}.cjs`)
    writeFileSync(bundle, result.outputFiles[0].contents)
    const { iosUsbToolBinary } = require(bundle)
    const name = platform === 'win32' ? 'iproxy.exe' : 'iproxy'
    const bundled = join('/installed/Resources', 'ios-usb', name)
    const development = join(process.cwd(), 'resources/ios-usb', platform === 'win32' ? 'win-x64' : 'darwin-arm64', name)
    process.env.USB_VIDEO_IPROXY_BIN = '/external/iproxy'
    globalThis.__iosToolFiles = new Set([bundled, development, '/external/iproxy', '/opt/homebrew/bin/iproxy'])
    assert.equal(iosUsbToolBinary('iproxy'), bundled)
    globalThis.__iosToolFiles.delete(bundled)
    assert.equal(iosUsbToolBinary('iproxy'), developmentMode ? development : null)
    globalThis.__iosToolFiles.delete(development)
    assert.equal(iosUsbToolBinary('iproxy'), null, 'external tools must not mask missing application resources')
  }
  console.log('iOS USB tools use only application-owned resources')
} finally {
  if (previous === undefined) delete process.env.USB_VIDEO_IPROXY_BIN
  else process.env.USB_VIDEO_IPROXY_BIN = previous
  delete globalThis.__iosToolFiles
  rmSync(temporary, { recursive: true, force: true })
}
