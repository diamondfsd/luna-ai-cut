import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

let source = null
try {
  source = await readFile(new URL('../src/shared/crashDiagnosticUtils.ts', import.meta.url), 'utf8')
} catch {
  // The assertion below reports a missing diagnostic module.
}
assert.ok(source, 'crash diagnostic utilities must exist')

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const diagnostics = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

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

console.log('crash diagnostic tests passed')
