import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const source = await readFile(new URL('../src/shared/dailyCheck.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
}).outputText
const dailyCheck = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const lateNight = new Date(2026, 8, 12, 23, 59, 59)
assert.equal(dailyCheck.localDateKey(lateNight), '2026-09-12')
assert.equal(dailyCheck.shouldRunDailyCheck('2026-09-12', lateNight), false)
assert.equal(dailyCheck.shouldRunDailyCheck('2026-09-11', lateNight), true)
assert.equal(dailyCheck.shouldRunDailyCheck(null, lateNight), true)

console.log('Hot update daily check scheduling verified')
