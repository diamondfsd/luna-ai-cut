import { readFile, rm } from 'node:fs/promises'
import type { SpecializedWorkerClient, SpecializedWorkerResult } from './specializedWorkerClient.js'

export interface SpecializedWorkerAttempt {
  result: SpecializedWorkerResult
  bytes: Buffer
}

export async function runSpecializedWorkerAttempt(
  worker: Pick<SpecializedWorkerClient, 'segment'>,
  command: Record<string, unknown>,
  outputPath: string,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<SpecializedWorkerAttempt> {
  await rm(outputPath, { force: true })
  const result = await worker.segment(command, signal)
  const bytes = await readFile(outputPath, { signal })
  if (bytes.byteLength !== expectedBytes) throw new Error('专用分割返回尺寸无效')
  return { result, bytes }
}
