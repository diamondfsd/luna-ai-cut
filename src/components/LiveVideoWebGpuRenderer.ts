import { getWebGpuContext, getWebGpuNavigator } from './webgpu/webgpuGpu'
import type { GpuBindGroup, GpuDevice, GpuPipeline, GpuQueue, GpuSampler, GpuTexture } from './webgpu/webgpuTypes'

const TEXTURE_BINDING = 0x04
const COPY_DST = 0x02

const shader = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0),
  );
  var coordinates = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  output.uv = coordinates[index];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(sourceTexture));
  let center = textureSample(sourceTexture, sourceSampler, input.uv);
  let neighbors = (
    textureSample(sourceTexture, sourceSampler, input.uv + vec2<f32>(texel.x, 0.0)) +
    textureSample(sourceTexture, sourceSampler, input.uv - vec2<f32>(texel.x, 0.0)) +
    textureSample(sourceTexture, sourceSampler, input.uv + vec2<f32>(0.0, texel.y)) +
    textureSample(sourceTexture, sourceSampler, input.uv - vec2<f32>(0.0, texel.y))
  ) * 0.25;
  let sharpened = clamp(center.rgb + (center.rgb - neighbors.rgb) * 0.18, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(sharpened, center.a);
}
`

type LivePreviewPipeline = GpuPipeline & { getBindGroupLayout(index: number): object }

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
  private readonly onDeviceLost: () => void
  private sourceTexture: GpuTexture | null = null
  private sourceBindGroup: GpuBindGroup | null = null
  private sourceSize = { width: 0, height: 0 }
  private inFlight = false
  private disposed = false

  private constructor(
    canvas: HTMLCanvasElement,
    context: NonNullable<ReturnType<typeof getWebGpuContext>>,
    device: GpuDevice,
    pipeline: LivePreviewPipeline,
    sampler: GpuSampler,
    onDeviceLost: () => void,
  ) {
    this.canvas = canvas
    this.context = context
    this.device = device
    this.pipeline = pipeline
    this.sampler = sampler
    this.onDeviceLost = onDeviceLost
    void device.lost.then(() => {
      if (this.disposed) return
      this.disposed = true
      this.sourceTexture?.destroy?.()
      this.sourceTexture = null
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
    const module = device.createShaderModule({ code: shader, label: 'live-preview-enhance' })
    const compilation = await module.getCompilationInfo?.()
    const shaderError = compilation?.messages?.find((message) => message.type === 'error')
    if (shaderError) throw new Error(shaderError.message ?? 'WebGPU 着色器初始化失败')
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    }) as LivePreviewPipeline
    const sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    })
    return new LiveVideoWebGpuRenderer(canvas, context, device, pipeline, sampler, onDeviceLost)
  }

  render(frame: DecodedFrameSource, outputWidth: number, outputHeight: number): boolean {
    if (this.disposed || this.inFlight) return false

    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight
    this.ensureSourceTexture(frame.displayWidth, frame.displayHeight)
    this.device.queue.copyExternalImageToTexture(
      { source: frame },
      { texture: this.sourceTexture },
      { width: frame.displayWidth, height: frame.displayHeight },
    )
    if (!this.sourceBindGroup) throw new Error('WebGPU 预览纹理未初始化')

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
    this.sourceTexture?.destroy?.()
    this.sourceTexture = null
  }

  private ensureSourceTexture(width: number, height: number): void {
    if (this.sourceTexture && this.sourceSize.width === width && this.sourceSize.height === height) return
    this.sourceTexture?.destroy?.()
    this.sourceTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: TEXTURE_BINDING | COPY_DST,
    })
    this.sourceSize = { width, height }
    this.sourceBindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sourceTexture.createView() },
        { binding: 1, resource: this.sampler },
      ],
    })
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
