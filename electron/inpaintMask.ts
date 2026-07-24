export const INPAINT_MODEL_SIZE = 512

export function resampleInpaintMask(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE)
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) {
    const sourceY = Math.min(height - 1, Math.floor(y * height / INPAINT_MODEL_SIZE))
    for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
      const sourceX = Math.min(width - 1, Math.floor(x * width / INPAINT_MODEL_SIZE))
      output[y * INPAINT_MODEL_SIZE + x] = input[sourceY * width + sourceX] >= 16 ? 255 : 0
    }
  }
  return output
}

export function dilateInpaintMask(input: Uint8Array, radius: number): Uint8Array {
  if (radius <= 0) return input.slice()
  const horizontal = new Uint8Array(input.length)
  const output = new Uint8Array(input.length)
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    for (let dx = -radius; dx <= radius; dx++) if (input[y * INPAINT_MODEL_SIZE + Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, x + dx))]) { horizontal[y * INPAINT_MODEL_SIZE + x] = 255; break }
  }
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    for (let dy = -radius; dy <= radius; dy++) if (horizontal[Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, y + dy)) * INPAINT_MODEL_SIZE + x]) { output[y * INPAINT_MODEL_SIZE + x] = 255; break }
  }
  return output
}

export function featherInpaintMask(input: Uint8Array, radius: number): Uint8Array {
  if (radius <= 0) return input.slice()
  const horizontal = new Uint8Array(input.length)
  const output = new Uint8Array(input.length)
  const size = radius * 2 + 1
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    let sum = 0
    for (let dx = -radius; dx <= radius; dx++) sum += input[y * INPAINT_MODEL_SIZE + Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, x + dx))]
    horizontal[y * INPAINT_MODEL_SIZE + x] = Math.round(sum / size)
  }
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    let sum = 0
    for (let dy = -radius; dy <= radius; dy++) sum += horizontal[Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, y + dy)) * INPAINT_MODEL_SIZE + x]
    output[y * INPAINT_MODEL_SIZE + x] = Math.round(sum / size)
  }
  return output
}
