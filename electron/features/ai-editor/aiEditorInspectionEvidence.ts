import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'

interface Receipt { fingerprint: string; times: Set<number>; updatedAt: number }
const receipts = new Map<string, Receipt>()
const MAX_RECEIPTS = 2000
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export async function inspectionFileIdentity(filePath: string) {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('素材文件不可读')
  return createHash('sha256').update(`${filePath}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`).digest('hex')
}

/** Receipt proves frames were extracted from this current file, not that an AI conclusion is correct. */
export async function recordInspectionEvidence(mediaId: string, filePath: string, times: readonly number[], expectedIdentity?: string) {
  const identity = await inspectionFileIdentity(filePath)
  if (expectedIdentity !== undefined && expectedIdentity !== identity) throw new Error('素材在分析期间发生变化，请重新分析')
  const previous = receipts.get(mediaId)
  const receipt = previous?.fingerprint === identity ? previous : { fingerprint: identity, times: new Set<number>(), updatedAt: Date.now() }
  times.forEach(time => receipt.times.add(time))
  receipt.updatedAt = Date.now()
  receipts.delete(mediaId)
  receipts.set(mediaId, receipt)
  while (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value!)
}

export async function assertInspectionEvidence(mediaId: string, filePath: string, times: readonly number[]) {
  const receipt = receipts.get(mediaId)
  if (!receipt || Date.now() - receipt.updatedAt > MAX_AGE_MS || receipt.fingerprint !== await inspectionFileIdentity(filePath)
    || !Array.isArray(times) || !times.length || times.some(time => !receipt.times.has(time))) {
    throw new Error('画面观察已失效或未完成，请重新分析素材')
  }
  return receipt.fingerprint
}
