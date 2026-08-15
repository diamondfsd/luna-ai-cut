import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-release-notes-'))
const compiledRoot = path.join(temporaryRoot, 'compiled')

try {
  const sourcePath = path.join(projectRoot, 'electron/releaseNotesService.ts')
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: compiledRoot,
    skipLibCheck: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  assert.equal(program.emit().emitSkipped, false)
  const { listReleaseNotes } = await import(pathToFileURL(path.join(compiledRoot, 'electron/releaseNotesService.js')))

  const hotRoot = path.join(temporaryRoot, 'hot')
  const bundledRoot = path.join(temporaryRoot, 'bundled')
  await mkdir(path.join(bundledRoot, 'old-release-log'), { recursive: true })
  await mkdir(hotRoot, { recursive: true })
  await writeFile(path.join(hotRoot, 'RELEASE_NOTES_v1.7.0-hot.3.md'), 'hot 3')
  await writeFile(path.join(hotRoot, 'RELEASE_NOTES_v1.7.0-hot.2.md'), 'hot 2 from update')
  await writeFile(path.join(bundledRoot, 'RELEASE_NOTES_v1.7.0-hot.2.md'), 'stale duplicate')
  await writeFile(path.join(bundledRoot, 'RELEASE_NOTES_v1.7.0.md'), 'stable')
  await writeFile(path.join(bundledRoot, 'old-release-log/RELEASE_NOTES_v1.6.7-hot.3.md'), 'old hot')

  const notes = listReleaseNotes([hotRoot, bundledRoot])
  assert.deepEqual(notes.map((note) => note.version), [
    '1.7.0-hot.3',
    '1.7.0-hot.2',
    '1.7.0',
    '1.6.7-hot.3',
  ])
  assert.equal(notes[1].content, 'hot 2 from update', '热更新目录中的说明应覆盖安装包内的同版本说明')
  console.log('release notes tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
