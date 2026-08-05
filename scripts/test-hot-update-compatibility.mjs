import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/shared/hotUpdateCompatibility.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const compatibility = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

assert.equal(compatibility.canLoadHotUpdate('1.6.8', '1.6.8-hot.12'), true)
assert.equal(compatibility.canLoadHotUpdate('v1.6.8', 'v1.6.8-hot.12'), true)
assert.equal(compatibility.canLoadHotUpdate('1.6.8-beta.4', '1.6.8-hot.12'), false)
assert.equal(compatibility.canLoadHotUpdate('1.6.8-rc.1', '1.6.8-hot.12'), false)
assert.equal(compatibility.canLoadHotUpdate('1.6.9', '1.6.8-hot.12'), false)
assert.equal(compatibility.canLoadHotUpdate('1.6.8', '1.6.7-hot.99'), false)
assert.equal(compatibility.canLoadHotUpdate('1.6.8', '1.6.8-beta.4'), false)
assert.equal(compatibility.canLoadHotUpdate('1.6.8', null), false)

console.log('Hot update compatibility verified')
