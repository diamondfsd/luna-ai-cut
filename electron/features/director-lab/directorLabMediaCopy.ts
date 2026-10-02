import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'

async function digest(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Reuse an interrupted copy only when it contains the same source bytes; never overwrite another take. */
export async function ensureDirectorMediaCopy(source: string, target: string, existingTargetBelongsToTake = false): Promise<void> {
  try {
    await fs.copyFile(source, target, constants.COPYFILE_EXCL)
    return
  } catch (error) {
    // A previously saved rename can leave an in-memory take pointing at its old, cleaned-up path.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && existingTargetBelongsToTake) {
      const targetInfo = await fs.lstat(target)
      if (targetInfo.isFile() && targetInfo.size > 0) return
    }
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const targetInfo = await fs.lstat(target)
  const sourceInfo = await fs.stat(source).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && existingTargetBelongsToTake && targetInfo.isFile() && targetInfo.size > 0) return null
    throw error
  })
  if (!sourceInfo) return
  if (!targetInfo.isFile() || sourceInfo.size !== targetInfo.size
    || await digest(source) !== await digest(target)) throw new Error('素材位置已有其他文件，请先调整镜头名称')
}
