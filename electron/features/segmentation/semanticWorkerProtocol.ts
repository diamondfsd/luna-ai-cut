export interface SemanticSegmentationResult {
  width: number
  height: number
  classId: number
  bytes: Buffer
}

export function parseSemanticWorkerOutput(output: Buffer): SemanticSegmentationResult {
  if (output.byteLength < 12) throw new Error('语义分割返回数据无效')
  const width = output.readUInt32LE(0)
  const height = output.readUInt32LE(4)
  const classId = output.readUInt32LE(8)
  const bytes = output.subarray(12)
  if (width === 0 || height === 0 || bytes.byteLength !== width * height) {
    throw new Error('语义分割返回尺寸无效')
  }
  return { width, height, classId, bytes }
}
