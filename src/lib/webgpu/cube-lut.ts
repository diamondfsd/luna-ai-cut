import {
  createIdentityLutData,
  parseCubeLut,
  resampleCubeLut,
} from '../../../packages/freecut-editor/src/infrastructure/gpu-effects/lut/cube-lut'

export const WEBGPU_LUT_SIZE = 33

export interface WebGpuLutData {
  size: number
  data: Uint8Array
}

export function parseWebGpuLut(text: string): WebGpuLutData {
  const parsed = resampleCubeLut(parseCubeLut(text), WEBGPU_LUT_SIZE)
  return { size: parsed.size, data: parsed.data }
}

export function identityWebGpuLut(): WebGpuLutData {
  return { size: 2, data: createIdentityLutData(2) }
}
