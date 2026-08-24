import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const source = await readFile(new URL('../electron/export/originalFileExportService.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const service = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const testDirectory = await mkdtemp(path.join(tmpdir(), 'luna-original-export-test-'))
const sourcePath = path.join(testDirectory, 'source.mov')
const outputPath = path.join(testDirectory, 'output.mov')
const canceledPath = path.join(testDirectory, 'canceled.mov')
const bytes = Buffer.from([0, 1, 2, 3, 254, 255])

try {
  await writeFile(sourcePath, bytes)
  await service.exportOriginalFile(sourcePath, outputPath)
  assert.deepEqual(await readFile(sourcePath), bytes, 'source file remains unchanged')
  assert.deepEqual(await readFile(outputPath), bytes, 'output is an exact byte-for-byte copy')

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    service.exportOriginalFile(sourcePath, canceledPath, controller.signal),
    (error) => error?.name === 'AbortError',
  )
  await assert.rejects(readFile(canceledPath), { code: 'ENOENT' })
} finally {
  await rm(testDirectory, { recursive: true, force: true })
}

console.log('Original file export tests passed')
