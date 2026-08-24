import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { deleteCustomLutInDirectory, listCustomLutsInDirectory } from '../electron/features/color/customLutLibrary.ts'

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-custom-luts-'))
const lutRoot = path.join(testRoot, 'luts')
const nestedRoot = path.join(lutRoot, '人像')
const outsidePath = path.join(testRoot, 'outside.cube')

try {
  await fs.mkdir(nestedRoot, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(lutRoot, 'Look10.cube'), 'LUT_3D_SIZE 2\n'),
    fs.writeFile(path.join(lutRoot, 'Look2.cube'), 'LUT_3D_SIZE 2\n'),
    fs.writeFile(path.join(nestedRoot, 'Alpha.CUBE'), 'LUT_3D_SIZE 2\n'),
    fs.writeFile(path.join(nestedRoot, 'Alpha.CUBE.meta.json'), '{}'),
    fs.writeFile(path.join(lutRoot, 'notes.txt'), 'ignore'),
    fs.writeFile(outsidePath, 'LUT_3D_SIZE 2\n'),
  ])

  const files = await listCustomLutsInDirectory(lutRoot)
  assert.deepEqual(files.map((file) => file.fileName), ['Alpha.CUBE', 'Look2.cube', 'Look10.cube'])
  assert.equal(files[0].relativeDirectory, '人像')

  const alphaPath = path.join(nestedRoot, 'Alpha.CUBE')
  await deleteCustomLutInDirectory(lutRoot, alphaPath)
  await assert.rejects(fs.access(alphaPath))
  await assert.rejects(fs.access(`${alphaPath}.meta.json`))
  await assert.rejects(deleteCustomLutInDirectory(lutRoot, outsidePath), /不在当前目录/)

  if (process.platform !== 'win32') {
    await fs.symlink(testRoot, path.join(lutRoot, 'linked-outside'))
    assert.equal((await listCustomLutsInDirectory(lutRoot)).some((file) => file.filePath === outsidePath), false)
  }
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

console.log('custom LUT library tests passed')
