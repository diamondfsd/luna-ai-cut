import { withTimeout } from './webgpuGpu'
import type { GpuDevice, GpuImageResource } from './webgpuTypes'

/** Copy the compositor target into a tightly packed RGBA buffer. */
export async function readWebGpuOutputFrame(
  device: GpuDevice,
  output: GpuImageResource,
  canvasFormat: string,
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const width = output.width
  const height = output.height
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: 0x01 | 0x08 })
  try {
    const encoder = device.createCommandEncoder({ label: 'luna-webgpu-readback' })
    encoder.copyTextureToBuffer(
      { texture: output.texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    )
    device.queue.submit([encoder.finish()])
    await withTimeout(buffer.mapAsync(0x01), 15_000, 'WebGPU 导出画面读回超时')
    const mapped = new Uint8Array(buffer.getMappedRange())
    const rgba = new Uint8Array(width * height * 4)
    const isBgra = canvasFormat.startsWith('bgra')
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
    if (bytesPerRow === width * 4 && !isBgra) {
      rgba.set(mapped.subarray(0, rgba.byteLength))
    } else if (isBgra && littleEndian && mapped.byteOffset % 4 === 0) {
      const packedSource = new Uint32Array(mapped.buffer, mapped.byteOffset, Math.floor(mapped.byteLength / 4))
      const packedTarget = new Uint32Array(rgba.buffer)
      for (let y = 0; y < height; y += 1) {
        const sourceRow = (y * bytesPerRow) / 4
        const targetRow = y * width
        for (let x = 0; x < width; x += 1) {
          const value = packedSource[sourceRow + x] ?? 0xff000000
          packedTarget[targetRow + x] = (value & 0xff00ff00) | ((value & 0x000000ff) << 16) | ((value & 0x00ff0000) >>> 16)
        }
      }
    } else {
      for (let y = 0; y < height; y += 1) {
        const sourceRow = y * bytesPerRow
        const targetRow = y * width * 4
        for (let x = 0; x < width; x += 1) {
          const sourceIndex = sourceRow + x * 4
          const targetIndex = targetRow + x * 4
          if (isBgra) {
            rgba[targetIndex] = mapped[sourceIndex + 2] ?? 0
            rgba[targetIndex + 1] = mapped[sourceIndex + 1] ?? 0
            rgba[targetIndex + 2] = mapped[sourceIndex] ?? 0
            rgba[targetIndex + 3] = mapped[sourceIndex + 3] ?? 255
          } else {
            rgba[targetIndex] = mapped[sourceIndex] ?? 0
            rgba[targetIndex + 1] = mapped[sourceIndex + 1] ?? 0
            rgba[targetIndex + 2] = mapped[sourceIndex + 2] ?? 0
            rgba[targetIndex + 3] = mapped[sourceIndex + 3] ?? 255
          }
        }
      }
    }
    buffer.unmap()
    return { rgba, width, height }
  } finally {
    buffer.destroy?.()
  }
}
