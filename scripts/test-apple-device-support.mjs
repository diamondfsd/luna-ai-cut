import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkAppleDeviceSupport, validateAppleInstallerSignature } from '../electron/platform/windows/appleDeviceSupport.ts'
import { AppleDriverInstaller } from '../electron/media/live-stream/appleDriverInstaller.ts'
import { downloadVerifiedFile } from '../electron/media/resumableDownloadService.ts'

const bytes = Buffer.from('isolated test installer')
const definition = {
  fileName: 'test.msi', url: 'https://fixture.invalid/driver', sizeBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

function installerFixture(options = {}) {
  const opened = []
  const verified = []
  const installer = new AppleDriverInstaller({
    platform: 'win32', arch: 'x64', definition, destinationDir: () => 'isolated-fixture',
    download: async (_directory, _definition, options) => {
      options.onProgress({ completedBytes: bytes.length, totalBytes: bytes.length, resumedBytes: 0 })
      return 'isolated-fixture/test.msi'
    },
    verifySignature: async (filePath) => { verified.push(filePath) },
    openInstaller: async (filePath) => { opened.push(filePath); return '' },
    ...options,
  })
  return { installer, opened, verified }
}

await test('only a confirmed missing Windows service requests installation', async () => {
  let probes = 0
  const probe = async () => { probes += 1; return true }
  assert.equal(await checkAppleDeviceSupport('win32', async () => 'missing', probe), 'missing')
  assert.equal(await checkAppleDeviceSupport('win32', async () => 'stopped', probe), 'stopped')
  assert.equal(await checkAppleDeviceSupport('win32', async () => { throw new Error('denied') }, probe), 'unavailable')
  assert.equal(await checkAppleDeviceSupport('darwin', async () => { assert.fail('Mac must not query Windows services') }, probe), 'not-required')
  assert.equal(probes, 0)
  assert.equal(await checkAppleDeviceSupport('win32', async () => 'running', probe), 'ready')
  assert.equal(await checkAppleDeviceSupport('win32', async () => 'running', async () => false), 'unavailable')
})

await test('untrusted or non-Apple signatures are rejected', () => {
  validateAppleInstallerSignature(JSON.stringify({ status: 'Valid', subject: 'CN=Apple Inc., O=Apple Inc., C=US' }))
  for (const signature of [
    { status: 'NotSigned', subject: 'CN=Apple Inc.' },
    { status: 'HashMismatch', subject: 'CN=Apple Inc.' },
    { status: 'Valid', subject: 'CN=Not Apple Inc., O=Example' },
    { status: 'Valid', subject: 'CN=Apple Inc.evil' },
    {},
  ]) assert.throws(() => validateAppleInstallerSignature(JSON.stringify(signature)), /验证失败/)
  assert.throws(() => validateAppleInstallerSignature('broken'))
})

await test('duplicate requests share one operation and open only after verification', async () => {
  const events = []
  const { installer, opened } = installerFixture({
    verifySignature: async () => { events.push('verify') },
    openInstaller: async (filePath) => { events.push('open'); opened.push(filePath); return '' },
  })
  const first = installer.install()
  assert.equal(installer.install(), first)
  await first
  assert.deepEqual(events, ['verify', 'open'])
  assert.equal(opened.length, 1)
  assert.deepEqual(installer.status(), { state: 'opened', completedBytes: bytes.length, totalBytes: bytes.length })
})

await test('cancellation blocks stale downloads and signature completions from opening an installer', async () => {
  for (const phase of ['download', 'verifySignature']) {
    let release
    const pending = new Promise(resolve => { release = resolve })
    let started
    const boundary = new Promise(resolve => { started = resolve })
    const { installer, opened } = installerFixture({
      [phase]: async () => { started(); await pending; return 'isolated-fixture/test.msi' },
    })
    const operation = installer.install()
    const rejection = assert.rejects(operation, /已取消/)
    await boundary
    installer.cancel()
    release()
    await rejection
    assert.equal(opened.length, 0)
    assert.equal(installer.status().state, 'error')
  }
})

await test('signature and shell failures do not claim installation succeeded and can be retried', async () => {
  const { installer, opened } = installerFixture({ verifySignature: async () => { throw new Error('invalid') } })
  await assert.rejects(installer.install(), /验证失败/)
  assert.equal(opened.length, 0)
  assert.equal(installer.status().state, 'error')
  let failures = 1
  const retry = installerFixture({ openInstaller: async () => failures-- > 0 ? 'cannot open' : '' }).installer
  await assert.rejects(retry.install(), /无法打开/)
  await retry.install()
  assert.equal(retry.status().state, 'opened')
})

await test('unsupported platforms do not download or open executables', async () => {
  for (const options of [{ platform: 'darwin' }, { arch: 'arm64' }]) {
    const { installer, opened } = installerFixture({ ...options, download: async () => assert.fail('must not download') })
    await assert.rejects(installer.install(), /不支持/)
    assert.equal(opened.length, 0)
  }
})

await test('corrupt downloads are never opened; interrupted downloads resume and verified cache is reused', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luna-driver-test-'))
  try {
    const bad = installerFixture({
      destinationDir: () => path.join(directory, 'bad'),
      download: (destination, file, options) => downloadVerifiedFile(destination, file, {
        ...options, fetcher: async () => new Response(Buffer.alloc(bytes.length, 0)),
      }),
    })
    await assert.rejects(bad.installer.install(), /下载失败/)
    assert.equal(bad.verified.length, 0)
    assert.equal(bad.opened.length, 0)

    const resumed = path.join(directory, 'resumed')
    await mkdir(resumed)
    const offset = 5
    await writeFile(path.join(resumed, `${definition.fileName}.${definition.sha256.slice(0, 16)}.download`), bytes.subarray(0, offset))
    let requests = 0
    const good = installerFixture({
      destinationDir: () => resumed,
      download: (destination, file, options) => downloadVerifiedFile(destination, file, {
        ...options, fetcher: async (_url, request) => {
          requests += 1
          assert.equal(request.headers.Range, `bytes=${offset}-`)
          return new Response(bytes.subarray(offset), {
            status: 206, headers: { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` },
          })
        },
      }),
    })
    await good.installer.install()
    assert.deepEqual(await readFile(path.join(resumed, definition.fileName)), bytes)
    await good.installer.install()
    assert.equal(requests, 1)
    assert.equal(good.opened.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
