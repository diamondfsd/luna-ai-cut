import type { RenderColorAdjustments } from '../../shared/types'

export type GpuTextureView = object
export type GpuSampler = object
export type GpuPipeline = object
export type GpuBindGroup = object
export type GpuCommandBuffer = object

export type GpuShaderModule = {
  getCompilationInfo?: () => Promise<{ messages?: Array<{ type?: string; message?: string; lineNum?: number }> }>
}

export type GpuBuffer = {
  destroy?: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
}

export type GpuTexture = {
  width?: number
  height?: number
  createView: (descriptor?: unknown) => GpuTextureView
  destroy?: () => void
}

export interface GpuRenderPass {
  setPipeline: (pipeline: GpuPipeline) => void
  setBindGroup: (index: number, bindGroup: GpuBindGroup) => void
  setViewport: (x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number) => void
  setScissorRect: (x: number, y: number, width: number, height: number) => void
  draw: (vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number) => void
  end: () => void
}

export interface GpuCommandEncoder {
  beginRenderPass: (descriptor: unknown) => GpuRenderPass
  copyTextureToTexture: (source: unknown, destination: unknown, copySize: unknown) => void
  copyTextureToBuffer: (source: unknown, destination: unknown, copySize: unknown) => void
  finish: () => GpuCommandBuffer
}

export interface GpuQueue {
  writeBuffer: (buffer: GpuBuffer, bufferOffset: number, data: ArrayBufferView) => void
  writeTexture: (destination: unknown, data: ArrayBufferView, dataLayout: unknown, size: unknown) => void
  copyExternalImageToTexture: (source: unknown, destination: unknown, copySize: unknown) => void
  submit: (commands: GpuCommandBuffer[]) => void
  onSubmittedWorkDone?: () => Promise<void>
}

export interface GpuDevice {
  queue: GpuQueue
  lost: Promise<{ reason?: string; message?: string }>
  pushErrorScope?: (filter: 'validation' | 'out-of-memory' | 'internal') => void
  popErrorScope?: () => Promise<{ name?: string; message?: string } | null>
  createShaderModule: (descriptor: unknown) => GpuShaderModule
  createBindGroupLayout: (descriptor: unknown) => object
  createPipelineLayout: (descriptor: unknown) => object
  createRenderPipeline: (descriptor: unknown) => GpuPipeline
  createSampler: (descriptor: unknown) => GpuSampler
  createTexture: (descriptor: unknown) => GpuTexture
  createBuffer: (descriptor: unknown) => GpuBuffer
  createBindGroup: (descriptor: unknown) => GpuBindGroup
  createCommandEncoder: (descriptor?: unknown) => GpuCommandEncoder
}

export interface GpuAdapter {
  requestDevice: (descriptor?: unknown) => Promise<GpuDevice>
}

export interface GpuNavigator {
  requestAdapter: (options?: unknown) => Promise<GpuAdapter | null>
  getPreferredCanvasFormat: () => string
}

export interface GpuCanvasContext {
  configure: (descriptor: unknown) => void
  getCurrentTexture: () => GpuTexture
}

export type GpuUploadSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas
export type GpuUploadCanvas = HTMLCanvasElement | OffscreenCanvas
export type WebGpuRenderCanvas = HTMLCanvasElement | OffscreenCanvas

export interface ExternalImageResource {
  source: HTMLImageElement | HTMLVideoElement
  width: number
  height: number
  ownedUrl?: string
}

export interface GpuImageResource {
  texture: GpuTexture
  width: number
  height: number
  external?: ExternalImageResource
}

export interface GpuVideoEntry {
  key: string
  video: HTMLVideoElement
  ready: boolean
  resource: GpuImageResource | null
  uploadCanvas: GpuUploadCanvas | null
  lastUploadedVideoTime: number
}

export interface GpuMaskResource {
  texture: GpuTexture
  width: number
  height: number
}

export interface GpuLutResource {
  texture: GpuTexture
  size: number
}

export interface WebGpuVideoRendererOptions {
  canvasWidth: number
  canvasHeight: number
  maxSide: number
  /** Use an RGBA offscreen target when the caller only needs raw readback. */
  captureFormat?: 'rgba'
  waitForGpu?: boolean
  rasterizeImages?: boolean
  presentToCanvas?: boolean
  onVideoElement: (element: HTMLMediaElement | null) => void
  onError: (reason: string) => void
  onRender: () => void
}

export interface RenderWaiter {
  resolve: () => void
  reject: (error: Error) => void
}

export interface PendingVideoSeek {
  entry: GpuVideoEntry
  sourceTime: number
}

export interface LayerResources {
  source: GpuImageResource
  mask: GpuMaskResource
  lut: GpuLutResource
  restoreLut: GpuLutResource
  maskPresent: boolean
  maskTransform: { translateX: number; translateY: number; scale: number; rotation: number } | undefined
}

export type RenderColor = RenderColorAdjustments
