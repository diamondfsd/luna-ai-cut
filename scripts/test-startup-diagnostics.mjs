import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const source = readFileSync(new URL('../electron/infrastructure/startupDiagnostics.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText
const { saveStartupFailure } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const directory = mkdtempSync(join(tmpdir(), 'luna-startup-diagnostics-'))
try {
  const blocked = join(directory, 'blocked')
  writeFileSync(blocked, 'not a directory')
  const unavailable = join(blocked, 'startup.log')
  const fallback = join(directory, 'fallback', 'startup.log')
  const error = new Error('Startup failed', { cause: new Error('Dependency missing') })
  const report = saveStartupFailure(error, 'Version: 1.9.0', [unavailable, fallback])
  assert.equal(report.logPath, fallback)
  assert.match(report.diagnostic, /Startup failed/)
  assert.match(report.diagnostic, /Dependency missing/)
  assert.match(readFileSync(fallback, 'utf8'), /日志写入失败/)
  saveStartupFailure('second failure', 'Version: 1.9.0', [fallback])
  assert.match(readFileSync(fallback, 'utf8'), /Startup failed[\s\S]*second failure/)
  const unsaved = saveStartupFailure(error, 'Version: 1.9.0', [unavailable])
  assert.equal(unsaved.logPath, null)
  assert.match(unsaved.diagnostic, /Dependency missing/)
  assert.match(unsaved.diagnostic, /日志写入失败/)
  console.log('Startup diagnostics tests passed')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
