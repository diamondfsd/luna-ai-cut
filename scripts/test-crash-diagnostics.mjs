import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

let source = null
let lrcRecoverySource = null
let lrcErrorSource = null
try {
  source = await readFile(new URL('../src/shared/crashDiagnosticUtils.ts', import.meta.url), 'utf8')
  lrcRecoverySource = await readFile(new URL('../src/shared/lrcInitGuardRecovery.ts', import.meta.url), 'utf8')
  lrcErrorSource = await readFile(new URL('../src/shared/lrcErrorDiagnostics.ts', import.meta.url), 'utf8')
} catch {
  // The first run is expected to fail until the diagnostic module exists.
}
assert.ok(source, 'crash diagnostic utilities must exist')
assert.ok(lrcRecoverySource, 'LRC init guard recovery utilities must exist')
assert.ok(lrcErrorSource, 'LRC error diagnostics must exist')

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const diagnostics = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const lrcRecoveryCompiled = ts.transpileModule(lrcRecoverySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const lrcRecovery = await import(`data:text/javascript;base64,${Buffer.from(lrcRecoveryCompiled).toString('base64')}`)
const lrcErrorCompiled = ts.transpileModule(lrcErrorSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const lrcError = await import(`data:text/javascript;base64,${Buffer.from(lrcErrorCompiled).toString('base64')}`)

const root = new Error('render failed')
const error = new Error('native call failed', { cause: root })
const serialized = diagnostics.serializeDiagnosticValue(error)
assert.equal(serialized.name, 'Error')
assert.equal(serialized.message, 'native call failed')
assert.match(serialized.stack, /native call failed/)
assert.equal(serialized.cause.message, 'render failed')

const cyclic = new Error('cyclic cause')
cyclic.cause = cyclic
assert.equal(diagnostics.serializeDiagnosticValue(cyclic).cause, '[Circular]')

assert.equal(
  diagnostics.isUncleanRunMarker({ status: 'running', pid: 123, startedAt: '2026-07-14T00:00:00.000Z' }),
  true,
)
assert.equal(diagnostics.isUncleanRunMarker({ status: 'clean', pid: 123 }), false)
assert.equal(diagnostics.isUncleanRunMarker(null), false)
assert.equal(diagnostics.isCrashDumpFile('pending/abc.dmp'), true)
assert.equal(diagnostics.isCrashDumpFile('settings.dat'), false)

const dumpEntries = Array.from({ length: 12 }, (_, index) => ({
  name: `dump-${index}.dmp`,
  mtimeMs: index,
}))
assert.deepEqual(
  diagnostics.selectCrashDumpFilesToPrune(dumpEntries, 10),
  ['dump-1.dmp', 'dump-0.dmp'],
)

assert.equal(lrcRecovery.LRC_INIT_GUARD_FILE, '.lrc-init-running.json')
assert.equal(lrcRecovery.LRC_INIT_RECOVERY_FILE, '.lrc-init-recovery-v2.json')
assert.equal(
  lrcRecovery.shouldRecoverLrcInitGuard({ packaged: true, guardExists: true, recoveryAttempted: false }),
  true,
  'a packaged app retries one legacy incomplete initialization',
)
assert.equal(
  lrcRecovery.shouldRecoverLrcInitGuard({ packaged: true, guardExists: true, recoveryAttempted: true }),
  false,
  'the recovery marker prevents an initialization crash loop',
)
assert.equal(
  lrcRecovery.shouldRecoverLrcInitGuard({ packaged: false, guardExists: true, recoveryAttempted: false }),
  false,
  'development does not persist compatibility recovery state',
)

const missingRuntime = lrcError.describeRenderInitFailure(new Error(
  'Error invoking remote method \'lrc:init\': Error: LRC_NATIVE_LOAD_FAILED\n' +
  '  - [present] C:\\app\\luna-render-core.node\n' +
  '    code=ERR_DLOPEN_FAILED\n' +
  '    error=The specified module could not be found.',
))
assert.match(missingRuntime.summary, /Visual C\+\+/)
assert.match(missingRuntime.detail, /ERR_DLOPEN_FAILED/)

const missingNative = lrcError.describeRenderInitFailure(new Error(
  'LRC_NATIVE_LOAD_FAILED\n  - [missing] C:\\app\\luna-render-core.node\n    code=MODULE_NOT_FOUND',
))
assert.match(missingNative.summary, /文件不完整/)

const incompatibleNative = lrcError.describeRenderInitFailure(new Error(
  'LRC_NATIVE_LOAD_FAILED\n  - [present] C:\\app\\luna-render-core.node\n' +
  '    code=ERR_DLOPEN_FAILED\n    error=%1 is not a valid Win32 application',
))
assert.match(incompatibleNative.summary, /不匹配/)

const blocked = lrcError.describeRenderInitFailure(new Error(
  'LRC_COMPATIBILITY_BLOCKED: previous native initialization did not complete',
))
assert.match(blocked.summary, /重新检测/)

console.log('crash diagnostic tests passed')
