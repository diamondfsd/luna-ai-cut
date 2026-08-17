import { WEBGPU_FLAGS } from './webgpu/constants'
import { formatWebGpuError, WebGpuRuntime } from './webgpu/runtime'
import { getWebGpuSourceDimensions, type WebGpuImageSource } from './webgpu/source'

export interface ColorGradeAdjustments {
  exposure: number
  brightness: number
  contrast: number
  saturation: number
  vibrance: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
}

export const DEFAULT_COLOR_GRADE: ColorGradeAdjustments = {
  exposure: 0,
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

export interface WebGpuRenderStats {
  submitMs: number
}

const COLOR_GRADE_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct GradeUniforms {
  tone: vec4f,
  color: vec4f,
  range: vec4f,
};

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> grade: GradeUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let tone = grade.tone;
  let color = grade.color;
  let range = grade.range;
  var c = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0).rgb;

  // Keep these operations close to the Rust color shader so the test page is
  // useful as a first approximation of the eventual WebGPU render path.
  c = c * exp2(tone.x);
  let bounded = clamp(c, vec3f(0.0), vec3f(1.0));
  let midtoneWeight = bounded * (vec3f(1.0) - bounded);
  c = c + midtoneWeight * (tone.y / 100.0) * 1.1;

  let temperature = color.y / 100.0;
  let tint = color.z / 100.0;
  let whiteBalance = vec3f(
    1.0 + temperature * 0.18 + tint * 0.04,
    1.0 - tint * 0.12,
    1.0 - temperature * 0.18 + tint * 0.04
  );
  c = c * whiteBalance;

  var y = luminance(c);
  let shadowMask = pow(1.0 - clamp(y, 0.0, 1.0), 2.0);
  let highlightMask = pow(clamp(y, 0.0, 1.0), 2.0);
  c = c + c * (range.x / 100.0) * shadowMask * 0.9;
  c = c + c * (tone.w / 100.0) * highlightMask * 0.9;
  c = c - c * (range.z / 100.0) * shadowMask * 0.85;
  c = c + (range.y / 100.0) * highlightMask * 0.35;

  let contrast = tone.z / 100.0;
  c = (c - vec3f(0.466)) * (1.0 + contrast * 0.55) + vec3f(0.466);
  y = luminance(c);
  c = mix(vec3f(y), c, 1.0 + color.x / 100.0);

  let maxChannel = max(c.r, max(c.g, c.b));
  let minChannel = min(c.r, min(c.g, c.b));
  let chroma = maxChannel - minChannel;
  c = mix(vec3f(luminance(c)), c, 1.0 + color.w / 100.0 * (1.0 - clamp(chroma, 0.0, 1.0)));

  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`

export class WebGpuColorRenderer {
  readonly canvas: HTMLCanvasElement
  private runtime: WebGpuRuntime | null = null
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat | null = null
  private inputTexture: GPUTexture | null = null
  private inputView: GPUTextureView | null = null
  private bindGroup: GPUBindGroup | null = null
  private inputWidth = 0
  private inputHeight = 0
  private uniformBuffer: GPUBuffer | null = null
  private pipeline: GPURenderPipeline | null = null
  private sampler: GPUSampler | null = null
  private lastSubmitPromise: Promise<void> = Promise.resolve()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  get isReady(): boolean {
    return this.device !== null && this.context !== null && this.pipeline !== null
  }

  get deviceName(): string {
    return this.device ? 'WebGPU device' : '未初始化'
  }

  async initialize(options: {
    onDeviceLost?: (message: string) => void
    onError?: (message: string) => void
  } = {}): Promise<void> {
    const runtime = await WebGpuRuntime.create({
      onDeviceLost: (message) => options.onDeviceLost?.(message),
      onUncapturedError: (message) => options.onError?.(message),
    })

    try {
      const context = this.canvas.getContext('webgpu')
      if (!context) throw new Error('无法创建 WebGPU 画布上下文')

      this.runtime = runtime
      this.device = runtime.device
      this.context = context
      this.format = runtime.capabilities.preferredCanvasFormat
      this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })

      const module = this.device.createShaderModule({
        label: 'webgpu-color-grade-test',
        code: COLOR_GRADE_SHADER,
      })
      const layout = this.device.createBindGroupLayout({
        label: 'webgpu-color-grade-test-layout',
        entries: [
          { binding: 0, visibility: WEBGPU_FLAGS.fragmentStage, sampler: { type: 'filtering' } },
          { binding: 1, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float' } },
          { binding: 2, visibility: WEBGPU_FLAGS.fragmentStage, buffer: { type: 'uniform' } },
        ],
      })
      this.pipeline = this.device.createRenderPipeline({
        label: 'webgpu-color-grade-test-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      })
      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
      this.uniformBuffer = this.device.createBuffer({
        label: 'webgpu-color-grade-test-uniforms',
        size: 48,
        usage: WEBGPU_FLAGS.bufferUniform | WEBGPU_FLAGS.bufferCopyDst,
      })
      this.bindGroup = null
    } catch (error) {
      runtime.destroy()
      throw new Error(formatWebGpuError(error))
    }
  }

  render(source: WebGpuImageSource, adjustments: ColorGradeAdjustments): WebGpuRenderStats {
    if (!this.device || !this.context || !this.pipeline || !this.sampler || !this.uniformBuffer) {
      throw new Error('WebGPU 尚未初始化')
    }

    const dimensions = getWebGpuSourceDimensions(source)
    if (dimensions.width < 2 || dimensions.height < 2) {
      throw new Error('媒体尺寸无效')
    }
    this.ensureInputTexture(dimensions.width, dimensions.height)
    if (!this.inputTexture || !this.inputView || !this.bindGroup) {
      throw new Error('无法创建 WebGPU 输入纹理')
    }

    const start = performance.now()
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.inputTexture },
      { width: dimensions.width, height: dimensions.height },
    )
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.toUniformData(adjustments))

    const encoder = this.device.createCommandEncoder({ label: 'webgpu-color-grade-test-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(6)
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.lastSubmitPromise = this.device.queue.onSubmittedWorkDone()

    return { submitMs: performance.now() - start }
  }

  async waitForGpu(): Promise<void> {
    await this.lastSubmitPromise
  }

  setSourceSize(width: number, height: number): void {
    if (!this.device || !this.context || !this.format) return
    if (this.canvas.width === width && this.canvas.height === height) return
    this.canvas.width = width
    this.canvas.height = height
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })
  }

  async toPngBlob(): Promise<Blob> {
    await this.waitForGpu()
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('无法读取 WebGPU 画布内容')
    return blob
  }

  destroy(): void {
    this.inputTexture?.destroy()
    this.uniformBuffer?.destroy()
    this.inputTexture = null
    this.uniformBuffer = null
    this.inputView = null
    this.bindGroup = null
    this.runtime?.destroy()
    this.runtime = null
    this.device = null
    this.context = null
    this.pipeline = null
  }

  private ensureInputTexture(width: number, height: number): void {
    if (!this.device) return
    if (this.inputTexture && this.inputWidth === width && this.inputHeight === height) return
    this.inputTexture?.destroy()
    this.inputTexture = this.device.createTexture({
      label: 'webgpu-color-grade-test-input',
      size: { width, height },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst | WEBGPU_FLAGS.textureRenderAttachment,
    })
    this.inputView = this.inputTexture.createView()
    this.inputWidth = width
    this.inputHeight = height
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler! },
        { binding: 1, resource: this.inputView },
        { binding: 2, resource: { buffer: this.uniformBuffer! } },
      ],
    })
    this.setSourceSize(width, height)
  }

  private toUniformData(adjustments: ColorGradeAdjustments): Float32Array {
    return new Float32Array([
      adjustments.exposure,
      adjustments.brightness,
      adjustments.contrast,
      adjustments.highlights,
      adjustments.saturation,
      adjustments.temperature,
      adjustments.tint,
      adjustments.vibrance,
      adjustments.shadows,
      adjustments.whites,
      adjustments.blacks,
      0,
    ])
  }
}
