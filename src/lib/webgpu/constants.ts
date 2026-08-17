// Electron versions used by Luna do not expose every WebGPU usage enum as a
// runtime object. Keep the specification values in one place for older builds.
export const WEBGPU_FLAGS = {
  vertexStage: 0x1,
  fragmentStage: 0x2,
  bufferCopyDst: 0x8,
  bufferUniform: 0x40,
  textureCopyDst: 0x2,
  textureBinding: 0x4,
  textureRenderAttachment: 0x10,
} as const
