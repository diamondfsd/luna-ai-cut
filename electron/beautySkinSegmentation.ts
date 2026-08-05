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

export function faceSkinMaskFromSamples(
  skinSamples: Uint32Array,
  protectedSamples: Uint32Array,
  totalSamples: Uint32Array,
  outputSize: number,
  featherRadius: number,
): Uint8Array {
  const expectedLength = outputSize * outputSize
  if (outputSize < 1
    || skinSamples.length !== expectedLength
    || protectedSamples.length !== expectedLength
    || totalSamples.length !== expectedLength) {
    throw new Error('面部皮肤分析数据尺寸不一致')
  }
  const output = new Uint8Array(expectedLength)
  let hasSkin = false
  for (let index = 0; index < output.length; index += 1) {
    const total = totalSamples[index]
    if (total === 0 || skinSamples[index] === 0) continue
    // Protected samples keep brows, eye contours and lips out of the skin mask.
    if (protectedSamples[index] > 0) continue
    output[index] = Math.round(skinSamples[index] / total * 255)
    hasSkin = true
  }
  return hasSkin ? softenBeautyMask(output, outputSize, featherRadius) : output
}

function closeMask(input: Uint8Array, size: number): Uint8Array {
  let current = input
  for (const mode of ['dilate', 'erode'] as const) {
    const output = new Uint8Array(input.length)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let active = mode === 'erode'
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const sampleY = Math.max(0, Math.min(size - 1, y + offsetY))
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = Math.max(0, Math.min(size - 1, x + offsetX))
            const selected = current[sampleY * size + sampleX] >= 128
            if (mode === 'dilate' && selected) active = true
            if (mode === 'erode' && !selected) active = false
          }
        }
        if (active) output[y * size + x] = 255
      }
    }
    current = output
  }
  return current
}

export function softenBeautyMask(input: Uint8Array, size: number, radius: number): Uint8Array {
  if (size < 1 || radius < 1 || input.length !== size * size) {
    throw new Error('美颜蒙版柔化尺寸不一致')
  }
  const closed = closeMask(input, size)
  const horizontal = new Float32Array(closed.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0
      let weightSum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(size - 1, x + offset))
        const weight = radius + 1 - Math.abs(offset)
        sum += closed[y * size + sampleX] * weight
        weightSum += weight
      }
      horizontal[y * size + x] = sum / weightSum
    }
  }
  const output = new Uint8Array(input.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0
      let weightSum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(size - 1, y + offset))
        const weight = radius + 1 - Math.abs(offset)
        sum += horizontal[sampleY * size + x] * weight
        weightSum += weight
      }
      output[y * size + x] = Math.round(sum / weightSum)
    }
  }
  return output
}
