import { parseWebGpuCube } from '../../components/webgpuPreviewMath'

export function captureLiveLutFrame(source: CanvasImageSource, width: number, height: number): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = 220
  canvas.height = Math.max(1, Math.round(220 * height / width))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const frame = context.getImageData(0, 0, canvas.width, canvas.height)
  let illuminated = 0
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    if (Math.max(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]) > 16) illuminated += 1
  }
  return illuminated / (frame.width * frame.height) >= 0.01 ? frame : null
}

export async function renderLiveLutThumbnail(frame: ImageData, path: string, intensity: number): Promise<string> {
  const bytes = await window.luna.workspace.loadLut(path)
  const { size, rgba } = parseWebGpuCube(new TextDecoder().decode(bytes))
  const output = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height)
  const strength = Math.max(0, Math.min(100, intensity)) / 100
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const coordinates = [0, 1, 2].map((channel) => frame.data[offset + channel] / 255 * (size - 1))
    const lower = coordinates.map(Math.floor)
    const fraction = coordinates.map((value, axis) => value - lower[axis])
    for (let channel = 0; channel < 3; channel += 1) {
      let value = 0
      for (let corner = 0; corner < 8; corner += 1) {
        const position = lower.map((base, axis) => Math.min(size - 1, base + ((corner >> axis) & 1)))
        const weight = fraction.reduce((product, part, axis) => product * (((corner >> axis) & 1) ? part : 1 - part), 1)
        value += rgba[(position[0] + position[1] * size + position[2] * size * size) * 4 + channel] * weight
      }
      output.data[offset + channel] = frame.data[offset + channel] * (1 - strength) + value * strength
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = output.width
  canvas.height = output.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成缩略图')
  context.putImageData(output, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}
