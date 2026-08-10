import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { copyLocalFilesToDirectory } from '../electron/localFileCopyService.ts'

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-ai-selection-copy-'))
const sourceDir = path.join(temporaryRoot, 'source')
const destinationDir = path.join(temporaryRoot, 'destination')

try {
  await Promise.all([mkdir(sourceDir), mkdir(destinationDir)])
  const sourcePath = path.join(sourceDir, 'IMG_0001.jpg')
  await Promise.all([
    writeFile(sourcePath, 'selected-media'),
    writeFile(path.join(destinationDir, 'IMG_0001.jpg'), 'existing-media'),
  ])

  const copied = await copyLocalFilesToDirectory([sourcePath], destinationDir)
  assert.equal(copied.copiedCount, 1)
  assert.equal(copied.failedCount, 0)
  assert.equal(await readFile(path.join(destinationDir, 'IMG_0001.jpg'), 'utf8'), 'existing-media')
  assert.equal(await readFile(path.join(destinationDir, 'IMG_0001 (1).jpg'), 'utf8'), 'selected-media')

  const sameFolder = await copyLocalFilesToDirectory([sourcePath], sourceDir)
  assert.equal(sameFolder.copiedCount, 0)
  assert.equal(sameFolder.failedCount, 1)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log('AI selection file copy tests passed')
