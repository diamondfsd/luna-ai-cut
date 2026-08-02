const BODY_SKIN_LABELS = new Set([12, 13, 14, 15])

export function bodySkinMaskFromHumanLabels(
  humanLabels: Uint8Array,
  inputSize: number,
  outputSize: number,
): Uint8Array {
  if (inputSize < 1 || outputSize < 1
    || humanLabels.length !== inputSize * inputSize) {
    throw new Error('身体皮肤分析数据尺寸不一致')
  }
  const output = new Uint8Array(outputSize * outputSize)
  for (let y = 0; y < outputSize; y += 1) {
    const sourceY = Math.min(inputSize - 1, Math.floor((y + 0.5) * inputSize / outputSize))
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = Math.min(inputSize - 1, Math.floor((x + 0.5) * inputSize / outputSize))
      const source = sourceY * inputSize + sourceX
      if (BODY_SKIN_LABELS.has(humanLabels[source])) output[y * outputSize + x] = 255
    }
  }
  return output
}
