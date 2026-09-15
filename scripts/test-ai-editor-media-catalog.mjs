import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const catalogModuleUrl = pathToFileURL(
  path.resolve('electron/features/ai-editor/aiEditorMediaCatalog.ts'),
).href

const baseDir = await mkdtemp(path.join(tmpdir(), 'luna-media-catalog-'))

try {
  const { assignAiEditorMediaIds } = await import(catalogModuleUrl)
  const first = await assignAiEditorMediaIds(baseDir, [
    { filePath: path.join(baseDir, 'first.mp4'), kind: 'video' },
    { filePath: path.join(baseDir, 'second.jpg'), kind: 'image' },
  ])
  assert.equal(first.get(path.join(baseDir, 'first.mp4')), 'm1')
  assert.equal(first.get(path.join(baseDir, 'second.jpg')), 'm2')

  const childScript = `
    const moduleUrl = ${JSON.stringify(catalogModuleUrl)}
    const baseDir = ${JSON.stringify(baseDir)}
    const path = await import('node:path')
    const { assignAiEditorMediaIds } = await import(moduleUrl)
    const result = await assignAiEditorMediaIds(baseDir, [
      { filePath: path.join(baseDir, 'first.mp4'), kind: 'video' },
      { filePath: path.join(baseDir, 'third.wav'), kind: 'audio' },
    ])
    process.stdout.write(JSON.stringify(Object.fromEntries(result)))
  `
  const restartResult = JSON.parse(execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', childScript],
    { encoding: 'utf8' },
  ))
  assert.equal(restartResult[path.join(baseDir, 'first.mp4')], 'm1')
  assert.equal(restartResult[path.join(baseDir, 'third.wav')], 'm3')

  const persisted = JSON.parse(await readFile(path.join(baseDir, 'ai-editor', 'media-index.json'), 'utf8'))
  assert.equal(persisted.nextId, 4)
  assert.equal(persisted.entries.m2.filePath, path.join(baseDir, 'second.jpg'))

  console.log('ai-editor media catalog: ok')
} finally {
  await rm(baseDir, { recursive: true, force: true })
}
