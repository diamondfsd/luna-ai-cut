import { BUFFER_USAGE_COPY_DST, BUFFER_USAGE_UNIFORM, createTexture, getWebGpuContext, getWebGpuNavigator, TEXTURE_USAGE_COPY_DST, TEXTURE_USAGE_RENDER_ATTACHMENT, TEXTURE_USAGE_TEXTURE_BINDING, writeTexture } from './webgpu/webgpuGpu'
import { parseWebGpuCube } from './webgpuPreviewMath'
import type { RenderColorAdjustments } from '../shared/types'
import type { GpuBindGroup, GpuBuffer, GpuDevice, GpuPipeline, GpuQueue, GpuSampler, GpuTexture } from './webgpu/webgpuTypes'
import { LIVE_VIDEO_PREVIEW_SHADER } from './liveVideoFsrShaders'

type LivePreviewPipeline = GpuPipeline & { getBindGroupLayout(index: number): object }

export type LiveVideoColorAdjustments = Pick<RenderColorAdjustments,
  | 'exposure'
  | 'black'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'vibrance'
  | 'temperature'
  | 'tint'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
>

const DEFAULT_COLOR_ADJUSTMENTS: LiveVideoColorAdjustments = {
  exposure: 0,
  black: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
}

interface DecodedFrameSource {
  displayWidth: number
  displayHeight: number
}

export class LiveVideoWebGpuRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly context: NonNullable<ReturnType<typeof getWebGpuContext>>
  private readonly device: GpuDevice
  private readonly pipeline: LivePreviewPipeline
  private readonly sampler: GpuSampler
  private readonly lutSampler: GpuSampler
  private readonly identityLutTexture: GpuTexture
  private readonly resolutionBuffer: GpuBuffer
  private readonly resolutionBindGroup: GpuBindGroup
  private readonly onDeviceLost: () => void
  private sourceTexture: GpuTexture | null = null
  private sourceBindGroup: GpuBindGroup | null = null
  private lutTexture: GpuTexture
  private lutSize = 0
  private lutIntensity = 0
  private colorAdjustments = DEFAULT_COLOR_ADJUSTMENTS
  private requestedLutPath: string | null = null
  private lutLoadSequence = 0
  private sourceSize = { width: 0, height: 0 }
  private inFlight = false
  private disposed = false

  private constructor(
    canvas: HTMLCanvasElement,
    context: NonNullable<ReturnType<typeof getWebGpuContext>>,
    device: GpuDevice,
    pipeline: LivePreviewPipeline,
    sampler: GpuSampler,
    lutSampler: GpuSampler,
    identityLutTexture: GpuTexture,
    resolutionBuffer: GpuBuffer,
    resolutionBindGroup: GpuBindGroup,
    onDeviceLost: () => void,
  ) {
    this.canvas = canvas
    this.context = context
    this.device = device
    this.pipeline = pipeline
    this.sampler = sampler
    this.lutSampler = lutSampler
    this.identityLutTexture = identityLutTexture
    this.lutTexture = identityLutTexture
    this.resolutionBuffer = resolutionBuffer
    this.resolutionBindGroup = resolutionBindGroup
    this.onDeviceLost = onDeviceLost
    void device.lost.then(() => {
      if (this.disposed) return
      this.disposed = true
      this.releaseGpuResources()
      this.onDeviceLost()
    })
  }

  static async create(canvas: HTMLCanvasElement, onDeviceLost: () => void): Promise<LiveVideoWebGpuRenderer | null> {
    const gpu = getWebGpuNavigator()
    const context = getWebGpuContext(canvas)
    if (!gpu || !context) return null
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const device = await adapter.requestDevice()
    const format = gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    const module = device.createShaderModule({ code: LIVE_VIDEO_PREVIEW_SHADER, label: 'live-preview-render' })
    const compilation = await module.getCompilationInfo?.()
    const shaderError = compilation?.messages?.find((message) => message.type === 'error')
    if (shaderError) throw new Error(shaderError.message ?? 'WebGPU 着色器初始化失败')

    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'previewMain', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    }) as LivePreviewPipeline
    const sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    })
    const lutSampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    })
    const identityLutTexture = createTexture(
      device,
      2,
      2,
      'rgba8unorm',
      TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING,
      2,
    )
    const identityLut = new Uint8Array(2 * 2 * 2 * 4)
    for (let z = 0; z < 2; z += 1) {
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 2; x += 1) {
          const offset = (z * 4 + y * 2 + x) * 4
          identityLut[offset] = x * 255
          identityLut[offset + 1] = y * 255
          identityLut[offset + 2] = z * 255
          identityLut[offset + 3] = 255
        }
      }
    }
    writeTexture(device, identityLutTexture, identityLut, 2, 2, 2)
    const hasValidationErrorScope = Boolean(device.pushErrorScope && device.popErrorScope)
    if (hasValidationErrorScope) device.pushErrorScope?.('validation')
    const resolutionBuffer = device.createBuffer({ size: 64, usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST })
    const resolutionBindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: resolutionBuffer } }],
    })
    const validationError = hasValidationErrorScope ? await device.popErrorScope?.() : null
    if (validationError) {
      resolutionBuffer.destroy?.()
      identityLutTexture.destroy?.()
      throw new Error(`WebGPU 直播画面参数初始化失败：${validationError.message ?? validationError.name ?? '资源验证失败'}`)
    }

    return new LiveVideoWebGpuRenderer(
      canvas,
      context,
      device,
      pipeline,
      sampler,
      lutSampler,
      identityLutTexture,
      resolutionBuffer,
      resolutionBindGroup,
      onDeviceLost,
    )
  }

  async setLut(path: string | null, intensity: number): Promise<void> {
    if (this.disposed) return
    this.lutIntensity = Math.max(0, Math.min(100, Number.isFinite(intensity) ? intensity : 0)) / 100
    if (path === this.requestedLutPath) return
    this.requestedLutPath = path
    const sequence = ++this.lutLoadSequence
    if (!path) {
      this.replaceLutTexture(this.identityLutTexture, 0)
      return
    }

    const bytes = await window.luna.workspace.loadLut(path)
    const parsed = parseWebGpuCube(new TextDecoder().decode(bytes))
    if (this.disposed || sequence !== this.lutLoadSequence) return
    const texture = createTexture(
      this.device,
      parsed.size,
      parsed.size,
      'rgba8unorm',
      TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING,
      parsed.size,
    )
    writeTexture(this.device, texture, parsed.rgba, parsed.size, parsed.size, parsed.size)
    this.replaceLutTexture(texture, parsed.size)
  }

  setColorAdjustments(adjustments: LiveVideoColorAdjustments): void {
    this.colorAdjustments = adjustments
  }

  render(frame: DecodedFrameSource, outputWidth: number, outputHeight: number): boolean {
    if (this.disposed || this.inFlight) return false

    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight
    this.ensureSourceTexture(frame.displayWidth, frame.displayHeight)
    if (!this.sourceBindGroup) throw new Error('WebGPU 预览纹理未初始化')

    this.device.queue.copyExternalImageToTexture(
      { source: frame },
      { texture: this.sourceTexture },
      { width: frame.displayWidth, height: frame.displayHeight },
    )
    this.device.queue.writeBuffer(this.resolutionBuffer, 0, new Float32Array([
      this.lutIntensity,
      this.lutSize,
      this.colorAdjustments.exposure,
      this.colorAdjustments.black,
      this.colorAdjustments.brightness,
      this.colorAdjustments.contrast,
      this.colorAdjustments.saturation,
      this.colorAdjustments.vibrance,
      this.colorAdjustments.temperature,
      this.colorAdjustments.tint,
      this.colorAdjustments.highlights,
      this.colorAdjustments.shadows,
      this.colorAdjustments.whites,
      this.colorAdjustments.blacks,
    ]))

    const encoder = this.device.createCommandEncoder({ label: 'live-preview-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.sourceBindGroup)
    pass.setBindGroup(1, this.resolutionBindGroup)
    pass.draw(4)
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.inFlight = true
    this.releaseFrameSlotWhenDone(this.device.queue)
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseGpuResources()
  }

  private ensureSourceTexture(width: number, height: number): void {
    if (this.sourceTexture && this.sourceSize.width === width && this.sourceSize.height === height) return
    this.sourceTexture?.destroy?.()
    this.sourceTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_RENDER_ATTACHMENT,
    })
    this.sourceSize = { width, height }
    this.rebuildSourceBindGroup()
  }

  private replaceLutTexture(texture: GpuTexture, size: number): void {
    const previousTexture = this.lutTexture
    this.lutTexture = texture
    this.lutSize = size
    this.rebuildSourceBindGroup()
    if (previousTexture !== texture && previousTexture !== this.identityLutTexture) previousTexture.destroy?.()
  }

  private rebuildSourceBindGroup(): void {
    if (!this.sourceTexture) {
      this.sourceBindGroup = null
      return
    }
    this.sourceBindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sourceTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.lutTexture.createView({ dimension: '3d' }) },
        { binding: 3, resource: this.lutSampler },
      ],
    })
  }

  private releaseGpuResources(): void {
    this.sourceTexture?.destroy?.()
    this.sourceTexture = null
    this.sourceBindGroup = null
    this.lutLoadSequence += 1
    if (this.lutTexture !== this.identityLutTexture) this.lutTexture.destroy?.()
    this.identityLutTexture.destroy?.()
    this.resolutionBuffer.destroy?.()
  }

  private releaseFrameSlotWhenDone(queue: GpuQueue): void {
    const complete = () => { this.inFlight = false }
    if (queue.onSubmittedWorkDone) {
      void queue.onSubmittedWorkDone().then(complete, complete)
      return
    }
    requestAnimationFrame(complete)
  }
}
