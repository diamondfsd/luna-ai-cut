import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { startDebugProxy } from '../electron/media/live-stream/iosProxyDebug.ts'

const dir = await mkdtemp(join(tmpdir(), 'luna-iproxy-test-'))
try {
  const script = join(dir, 'fake-proxy.mjs')
  await writeFile(script, `process.stdout.write(process.argv.slice(2).join(' ')); process.stderr.write(' bind failed'); process.exitCode = 7`)
  const wrapper = join(dir, 'proxy')
  if (process.platform !== 'win32') {
    await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
    const tested = startDebugProxy(wrapper, 12345, 4184, 'private-device')
    await once(tested.child, 'close')
    const detail = await tested.failureDetail()
    assert.match(detail, /退出码 7/)
    assert.match(detail, /-u \[手机标识\] 12345:4184/)
    assert.match(detail, /bind failed/)
    assert.doesNotMatch(detail, /private-device/)
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}
