export interface BeautyBlemishDetection {
  acneMask: Uint8Array
  spotMask: Uint8Array
  wrinkleMask: Uint8Array
  acneCount: number
  spotCount: number
  wrinkleCount: number
}

interface MaskComponent {
  pixels: number[]
  left: number
  top: number
  right: number
  bottom: number
}

function mergeMasks(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length)
  for (let index = 0; index < output.length; index += 1) output[index] = Math.max(left[index], right[index])
  return output
}

function buildIntegral(values: Float32Array, size: number): Float64Array {
  const stride = size + 1
  const output = new Float64Array(stride * stride)
  for (let y = 0; y < size; y += 1) {
    let row = 0
    for (let x = 0; x < size; x += 1) {
      row += values[y * size + x]
      output[(y + 1) * stride + x + 1] = output[y * stride + x + 1] + row
    }
  }
  return output
}

function localMean(integral: Float64Array, size: number, x: number, y: number, radius: number): number {
  const stride = size + 1
  const left = Math.max(0, x - radius)
  const top = Math.max(0, y - radius)
  const right = Math.min(size - 1, x + radius)
  const bottom = Math.min(size - 1, y + radius)
  const sum = integral[(bottom + 1) * stride + right + 1]
    - integral[top * stride + right + 1]
    - integral[(bottom + 1) * stride + left]
    + integral[top * stride + left]
  return sum / ((right - left + 1) * (bottom - top + 1))
}

function connectedComponents(mask: Uint8Array, size: number, threshold = 24): MaskComponent[] {
  const visited = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const output: MaskComponent[] = []
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || mask[start] < threshold) continue
    let read = 0
    let write = 0
    queue[write++] = start
    visited[start] = 1
    const component: MaskComponent = {
      pixels: [],
      left: size,
      top: size,
      right: -1,
      bottom: -1,
    }
    while (read < write) {
      const index = queue[read++]
      const x = index % size
      const y = Math.floor(index / size)
      component.pixels.push(index)
      component.left = Math.min(component.left, x)
      component.top = Math.min(component.top, y)
      component.right = Math.max(component.right, x)
      component.bottom = Math.max(component.bottom, y)
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX < 0 || nextX >= size || nextY < 0 || nextY >= size) continue
          const next = nextY * size + nextX
          if (visited[next] || mask[next] < threshold) continue
          visited[next] = 1
          queue[write++] = next
        }
      }
    }
    output.push(component)
  }
  return output
}

function softenWrinkles(raw: Uint8Array, labels: Uint8Array, size: number): { mask: Uint8Array; count: number } {
  const selected = new Uint8Array(raw.length)
  const maxSpan = Math.max(12, Math.round(size * 0.3))
  let count = 0
  for (const component of connectedComponents(raw, size, 18)) {
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    const length = Math.max(width, height)
    const thickness = component.pixels.length / Math.max(1, length)
    const aspect = length / Math.max(1, Math.min(width, height))
    if (component.pixels.length < 5 || length > maxSpan) continue
    if (aspect < 2.2 && !(length >= 12 && thickness <= 4)) continue
    count += 1
    for (const index of component.pixels) selected[index] = Math.max(selected[index], raw[index])
  }

  const expanded = new Uint8Array(raw.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (labels[y * size + x] !== 1) continue
      let value = 0
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = y + offsetY
        if (sampleY < 0 || sampleY >= size) continue
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX
          if (sampleX < 0 || sampleX >= size) continue
          value = Math.max(value, selected[sampleY * size + sampleX])
        }
      }
      expanded[y * size + x] = value
    }
  }

  const output = new Uint8Array(raw.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (labels[y * size + x] !== 1) continue
      let sum = 0
      let samples = 0
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(size - 1, y + offsetY))
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(size - 1, x + offsetX))
          sum += expanded[sampleY * size + sampleX]
          samples += 1
        }
      }
      output[y * size + x] = Math.round(sum / samples)
    }
  }
  return { mask: output, count }
}

function softenComponents(raw: Uint8Array, labels: Uint8Array, size: number): { mask: Uint8Array; count: number } {
  const selected = new Uint8Array(raw.length)
  const maxPixels = Math.max(12, Math.round(size * size * 0.0018))
  const maxSpan = Math.max(8, Math.round(size * 0.065))
  let count = 0
  for (const component of connectedComponents(raw, size)) {
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height))
    if (component.pixels.length < 2 || component.pixels.length > maxPixels) continue
    if (width > maxSpan || height > maxSpan || aspect > 4) continue
    count += 1
    for (const index of component.pixels) {
      const confidence = Math.min(255, Math.round(64 + raw[index] * 1.5))
      selected[index] = Math.max(selected[index], confidence)
    }
  }

  const dilated = new Uint8Array(raw.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (labels[y * size + x] !== 1) continue
      let value = 0
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        const sampleY = y + offsetY
        if (sampleY < 0 || sampleY >= size) continue
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = x + offsetX
          if (sampleX < 0 || sampleX >= size) continue
          value = Math.max(value, selected[sampleY * size + sampleX])
        }
      }
      dilated[y * size + x] = value
    }
  }

  const output = new Uint8Array(raw.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (labels[y * size + x] !== 1) continue
      let sum = 0
      let samples = 0
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(size - 1, y + offsetY))
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(size - 1, x + offsetX))
          sum += dilated[sampleY * size + sampleX]
          samples += 1
        }
      }
      output[y * size + x] = Math.round(sum / samples)
    }
  }
  return { mask: output, count }
}

/** Detects small local color anomalies only inside the face-parser's skin class. */
export function detectFaceBlemishes(
  rgb: Uint8Array,
  labels: Uint8Array,
  size: number,
): BeautyBlemishDetection {
  if (rgb.length !== size * size * 3 || labels.length !== size * size) {
    throw new Error('面部瑕疵分析数据尺寸不一致')
  }
  const luminance = new Float32Array(size * size)
  const redness = new Float32Array(size * size)
  for (let index = 0; index < labels.length; index += 1) {
    const offset = index * 3
    const red = rgb[offset]
    const green = rgb[offset + 1]
    const blue = rgb[offset + 2]
    luminance[index] = red * 0.299 + green * 0.587 + blue * 0.114
    redness[index] = red - (green + blue) / 2
  }
  const luminanceIntegral = buildIntegral(luminance, size)
  const rednessIntegral = buildIntegral(redness, size)
  const radius = Math.max(5, Math.round(size * 0.025))
  const rawAcne = new Uint8Array(labels.length)
  const rawSpots = new Uint8Array(labels.length)
  const rawBrightSpots = new Uint8Array(labels.length)
  const rawWrinkles = new Uint8Array(labels.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x
      if (labels[index] !== 1) continue
      const localLuminance = localMean(luminanceIntegral, size, x, y, radius)
      const localRedness = localMean(rednessIntegral, size, x, y, radius)
      const darkDelta = localLuminance - luminance[index]
      const brightDelta = luminance[index] - localLuminance
      const redDelta = redness[index] - localRedness
      if (redDelta > 6 && luminance[index] > 24) {
        rawAcne[index] = Math.min(255, Math.round((redDelta - 6) * 12))
      }
      if (darkDelta > 9 && redDelta < 8) {
        rawSpots[index] = Math.min(255, Math.round((darkDelta - 9) * 11))
      }
      if (brightDelta > 14 && redDelta < 14) {
        rawBrightSpots[index] = Math.min(255, Math.round((brightDelta - 14) * 10))
      }
      if (x >= 2 && x < size - 2 && y >= 2 && y < size - 2) {
        const horizontal = (luminance[(y - 2) * size + x] + luminance[(y + 2) * size + x]) / 2 - luminance[index]
        const vertical = (luminance[y * size + x - 2] + luminance[y * size + x + 2]) / 2 - luminance[index]
        const diagonalDown = (luminance[(y - 2) * size + x - 2] + luminance[(y + 2) * size + x + 2]) / 2 - luminance[index]
        const diagonalUp = (luminance[(y - 2) * size + x + 2] + luminance[(y + 2) * size + x - 2]) / 2 - luminance[index]
        const lineContrast = Math.max(horizontal, vertical, diagonalDown, diagonalUp)
        const wrinkleScore = lineContrast * 0.75 + Math.max(0, darkDelta) * 0.25
        if (wrinkleScore > 4) rawWrinkles[index] = Math.min(255, Math.round((wrinkleScore - 4) * 12))
      }
    }
  }
  const acne = softenComponents(rawAcne, labels, size)
  const spots = softenComponents(rawSpots, labels, size)
  const brightSpots = softenComponents(rawBrightSpots, labels, size)
  const wrinkles = softenWrinkles(rawWrinkles, labels, size)
  return {
    acneMask: acne.mask,
    spotMask: mergeMasks(spots.mask, brightSpots.mask),
    wrinkleMask: wrinkles.mask,
    acneCount: acne.count,
    spotCount: spots.count + brightSpots.count,
    wrinkleCount: wrinkles.count,
  }
}
