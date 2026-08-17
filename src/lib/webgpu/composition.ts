import type { CompositionInput, CompositionLayer, RenderColorAdjustments } from '../../shared/types'
import { WEBGPU_FLAGS } from './constants'
import { identityWebGpuLut, parseWebGpuLut, type WebGpuLutData } from './cube-lut'
import { formatWebGpuError, WebGpuRuntime } from './runtime'
import { getWebGpuSourceDimensions, type WebGpuImageSource } from './source'

export interface WebGpuCompositionRenderStats {
  submitMs: number
  layerCount: number
}

export interface WebGpuCompositionRendererOptions {
  resolveImage: (path: string) => Promise<WebGpuImageSource>
  resolveSource?: (layer: CompositionLayer) => Promise<WebGpuImageSource>
  resolveLut?: (path: string) => Promise<string>
  onDeviceLost?: (message: string) => void
  onError?: (message: string) => void
}

interface CachedImageTexture {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
}

interface CachedLutTexture extends WebGpuLutData {
  texture: GPUTexture
  view: GPUTextureView
}

type SupportedBlendMode = 'normal' | 'multiply' | 'screen' | 'add'

const BLEND_MODES: SupportedBlendMode[] = ['normal', 'multiply', 'screen', 'add']

function paddedLutData(lut: WebGpuLutData): { data: Uint8Array; bytesPerRow: number } {
  const rowBytes = lut.size * 4
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256
  if (bytesPerRow === rowBytes) return { data: lut.data, bytesPerRow }

  const data = new Uint8Array(bytesPerRow * lut.size * lut.size)
  for (let depth = 0; depth < lut.size; depth++) {
    for (let row = 0; row < lut.size; row++) {
      const sourceOffset = (depth * lut.size + row) * rowBytes
      const targetOffset = (depth * lut.size + row) * bytesPerRow
      data.set(lut.data.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset)
    }
  }
  return { data, bytesPerRow }
}

const COMPOSITION_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct LayerUniforms {
  rect: vec4f,
  sourceRect: vec4f,
  transform: vec4f,
  style: vec4f,
  color: vec4f,
  range: vec4f,
  extra: vec4f,
};

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> layer: LayerUniforms;
@group(0) @binding(3) var lutTexture: texture_3d<f32>;
@group(0) @binding(4) var restoreLutTexture: texture_3d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
  );
  let sourcePosition = positions[vertexIndex];
  let centered = sourcePosition - vec2f(0.5, 0.5);
  let angle = layer.transform.y;
  let rotated = vec2f(
    centered.x * cos(angle) - centered.y * sin(angle),
    centered.x * sin(angle) + centered.y * cos(angle)
  ) * max(layer.transform.x, 0.0001);
  let localPosition = rotated + vec2f(0.5, 0.5);
  let canvasPosition = layer.rect.xy + localPosition * layer.rect.zw;

  var output: VertexOutput;
  output.position = vec4f(canvasPosition.x * 2.0 - 1.0, 1.0 - canvasPosition.y * 2.0, 0.0, 1.0);
  var uv = sourcePosition;
  if (layer.transform.z > 0.5) { uv.x = 1.0 - uv.x; }
  if (layer.transform.w > 0.5) { uv.y = 1.0 - uv.y; }
  output.uv = layer.sourceRect.xy + uv * layer.sourceRect.zw;
  return output;
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn applyColor(cIn: vec3f) -> vec3f {
  let tone = layer.style;
  let color = layer.color;
  let range = layer.range;
  var c = cIn * exp2(tone.y);
  let bounded = clamp(c, vec3f(0.0), vec3f(1.0));
  let midtoneWeight = bounded * (vec3f(1.0) - bounded);
  c = c + midtoneWeight * (tone.z / 100.0) * 1.1;

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
  c = c + c * (range.y / 100.0) * shadowMask * 0.9;
  c = c + c * (range.x / 100.0) * highlightMask * 0.9;
  c = c - c * (range.w / 100.0) * shadowMask * 0.85;
  c = c + (range.z / 100.0) * highlightMask * 0.35;

  let contrast = tone.w / 100.0;
  c = (c - vec3f(0.466)) * (1.0 + contrast * 0.55) + vec3f(0.466);
  y = luminance(c);
  c = mix(vec3f(y), c, 1.0 + color.x / 100.0);

  let maxChannel = max(c.r, max(c.g, c.b));
  let minChannel = min(c.r, min(c.g, c.b));
  let chroma = maxChannel - minChannel;
  c = mix(vec3f(luminance(c)), c, 1.0 + color.w / 100.0 * (1.0 - clamp(chroma, 0.0, 1.0)));
  c = c + vec3f(layer.extra.x / 100.0);
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

fn sampleLut(texture: texture_3d<f32>, color: vec3f, size: f32) -> vec3f {
  let coords = (clamp(color, vec3f(0.0), vec3f(1.0)) * (size - 1.0) + vec3f(0.5)) / size;
  return textureSampleLevel(texture, sourceSampler, coords, 0.0).rgb;
}

fn applyLut(cIn: vec3f) -> vec3f {
  var c = cIn;
  let restoreSize = layer.extra.w;
  if (restoreSize >= 2.0) {
    c = sampleLut(restoreLutTexture, c, restoreSize);
  }
  let intensity = clamp(layer.extra.y, 0.0, 1.0);
  if (intensity <= 0.0) { return c; }
  let size = max(layer.extra.z, 2.0);
  return mix(c, sampleLut(lutTexture, c, size), intensity);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let sampled = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  return vec4f(applyLut(applyColor(sampled.rgb)), sampled.a * layer.style.x);
}
`

function colorValue(color: RenderColorAdjustments | undefined, key: keyof RenderColorAdjustments): number {
  const value = color?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function sourceRectForLayer(
  layer: CompositionLayer,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number, number] {
  const requested = layer.sourceRect ?? { x: 0, y: 0, w: 1, h: 1 }
  let x = Math.max(0, Math.min(1, requested.x))
  let y = Math.max(0, Math.min(1, requested.y))
  let w = Math.max(0.0001, Math.min(1 - x, requested.w))
  let h = Math.max(0.0001, Math.min(1 - y, requested.h))
  if (layer.fit === 'stretch' || layer.fit === 'cover-scale') return [x, y, w, h]

  const targetAspect = Math.max(
    0.0001,
    (layer.rect.w * canvasWidth) / Math.max(layer.rect.h * canvasHeight, 0.0001),
  )
  const sourceAspect = Math.max(0.0001, (sourceWidth * w) / Math.max(sourceHeight * h, 0.0001))
  if (layer.fit === 'contain') return [x, y, w, h]
  if (sourceAspect > targetAspect) {
    const croppedWidth = h * targetAspect * sourceHeight / sourceWidth
    x += (w - croppedWidth) / 2
    w = croppedWidth
  } else {
    const croppedHeight = w / targetAspect * sourceWidth / sourceHeight
    y += (h - croppedHeight) / 2
    h = croppedHeight
  }
  return [x, y, w, h]
}

function destinationRectForLayer(
  layer: CompositionLayer,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number, number] {
  if (layer.fit !== 'contain') return [layer.rect.x, layer.rect.y, layer.rect.w, layer.rect.h]
  const sourceAspect = Math.max(0.0001, sourceWidth / sourceHeight)
  const targetAspect = Math.max(
    0.0001,
    (layer.rect.w * canvasWidth) / Math.max(layer.rect.h * canvasHeight, 0.0001),
  )
  if (sourceAspect > targetAspect) {
    const height = layer.rect.w / sourceAspect
    return [layer.rect.x, layer.rect.y + (layer.rect.h - height) / 2, layer.rect.w, height]
  }
  const width = layer.rect.h * sourceAspect
  return [layer.rect.x + (layer.rect.w - width) / 2, layer.rect.y, width, layer.rect.h]
}

function blendState(mode: SupportedBlendMode): GPUBlendState {
  switch (mode) {
    case 'multiply':
      return {
        color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
    case 'screen':
      return {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
    case 'add':
      return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
    case 'normal':
      return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }
  }
}

export class WebGpuCompositionRenderer {
  readonly canvas: HTMLCanvasElement

  private runtime: WebGpuRuntime | null = null
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat | null = null
  private sampler: GPUSampler | null = null
  private uniformBuffers: GPUBuffer[] = []
  private pipelines = new Map<SupportedBlendMode, GPURenderPipeline>()
  private imageTextures = new Map<string, CachedImageTexture>()
  private videoTextures = new Map<string, CachedImageTexture>()
  private lutTextures = new Map<string, CachedLutTexture>()
  private identityLut: CachedLutTexture | null = null
  private lastSubmitPromise: Promise<void> = Promise.resolve()
  private resolveImage: ((path: string) => Promise<WebGpuImageSource>) | null = null
  private resolveSource: ((layer: CompositionLayer) => Promise<WebGpuImageSource>) | null = null
  private resolveLut: ((path: string) => Promise<string>) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  get isReady(): boolean {
    return this.runtime !== null && this.context !== null && this.pipelines.size === BLEND_MODES.length
  }

  async initialize(options: WebGpuCompositionRendererOptions): Promise<void> {
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
      this.resolveImage = options.resolveImage
      this.resolveSource = options.resolveSource ?? null
      this.resolveLut = options.resolveLut ?? null
      this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })

      const module = this.device.createShaderModule({ label: 'webgpu-composition', code: COMPOSITION_SHADER })
      const layout = this.device.createBindGroupLayout({
        label: 'webgpu-composition-layout',
        entries: [
          { binding: 0, visibility: WEBGPU_FLAGS.fragmentStage, sampler: { type: 'filtering' } },
          { binding: 1, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float' } },
          { binding: 2, visibility: WEBGPU_FLAGS.fragmentStage, buffer: { type: 'uniform' } },
          { binding: 3, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float', viewDimension: '3d' } },
          { binding: 4, visibility: WEBGPU_FLAGS.fragmentStage, texture: { sampleType: 'float', viewDimension: '3d' } },
        ],
      })
      const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] })
      for (const mode of BLEND_MODES) {
        this.pipelines.set(mode, this.device.createRenderPipeline({
          label: `webgpu-composition-${mode}`,
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vertexMain' },
          fragment: {
            module,
            entryPoint: 'fragmentMain',
            targets: [{ format: this.format, blend: blendState(mode) }],
          },
          primitive: { topology: 'triangle-list' },
        }))
      }
      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    } catch (error) {
      runtime.destroy()
      throw new Error(formatWebGpuError(error))
    }
  }

  async render(composition: CompositionInput, time = 0): Promise<WebGpuCompositionRenderStats> {
    if (!this.device || !this.context || !this.sampler || !this.format) {
      throw new Error('WebGPU 合成渲染器尚未初始化')
    }
    if (!this.resolveImage) throw new Error('WebGPU 合成渲染器缺少图片加载器')
    if (composition.canvas.width < 1 || composition.canvas.height < 1) throw new Error('合成画布尺寸无效')

    this.setCanvasSize(composition.canvas.width, composition.canvas.height)
    const layers = [...composition.layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const draws: Array<{
      source: CachedImageTexture
      lut: CachedLutTexture
      restoreLut: CachedLutTexture
      targetRect: [number, number, number, number]
      sourceRect: [number, number, number, number]
      uniforms: Float32Array
      pipeline: GPURenderPipeline
    }> = []
    let renderedLayers = 0
    const start = performance.now()
    for (const layer of layers) {
      if (layer.activeStart != null && time < layer.activeStart) continue
      if (layer.activeEnd != null && time >= layer.activeEnd) continue
      if ((layer.layerType ?? 'media') !== 'media') {
        throw new Error('当前 WebGPU 合成渲染器仅支持媒体图层')
      }
      const source = await this.getLayerTexture(layer)
      const targetRect = destinationRectForLayer(
        layer,
        source.width,
        source.height,
        composition.canvas.width,
        composition.canvas.height,
      )
      const sourceRect = sourceRectForLayer(
        layer,
        source.width,
        source.height,
        composition.canvas.width,
        composition.canvas.height,
      )
      const luts = await this.getLayerLuts(layer)
      const transform = layer.transform
      const uniforms = new Float32Array([
        ...targetRect,
        ...sourceRect,
        transform?.scale ?? 1,
        ((transform?.orientation ?? 0) + (transform?.rotate ?? 0)) * Math.PI / 180,
        transform?.flipH ? 1 : 0,
        transform?.flipV ? 1 : 0,
        layer.opacity ?? 1,
        colorValue(layer.color, 'exposure'),
        colorValue(layer.color, 'brightness'),
        colorValue(layer.color, 'contrast'),
        colorValue(layer.color, 'saturation'),
        colorValue(layer.color, 'temperature'),
        colorValue(layer.color, 'tint'),
        colorValue(layer.color, 'vibrance'),
        colorValue(layer.color, 'highlights'),
        colorValue(layer.color, 'shadows'),
        colorValue(layer.color, 'whites'),
        colorValue(layer.color, 'blacks'),
        colorValue(layer.color, 'black'),
        layer.lutId ? Math.max(0, Math.min(100, layer.lutIntensity ?? 100)) / 100 : 0,
        luts.creative.size,
        luts.restore?.size ?? 0,
      ])
      const mode = (layer.blendMode ?? 'normal') as SupportedBlendMode
      const pipeline = this.pipelines.get(BLEND_MODES.includes(mode) ? mode : 'normal')!
      draws.push({ source, lut: luts.creative, restoreLut: luts.restore ?? luts.creative, targetRect, sourceRect, uniforms, pipeline })
    }

    const encoder = this.device.createCommandEncoder({ label: 'webgpu-composition-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })

    for (const [index, draw] of draws.entries()) {
      const uniformBuffer = this.ensureUniformBuffer(index)
      this.device.queue.writeBuffer(uniformBuffer, 0, draw.uniforms)
      const bindGroup = this.device.createBindGroup({
        layout: draw.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: draw.source.view },
          { binding: 2, resource: { buffer: uniformBuffer } },
          { binding: 3, resource: draw.lut.view },
          { binding: 4, resource: draw.restoreLut.view },
        ],
      })
      pass.setPipeline(draw.pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(6)
      renderedLayers += 1
    }
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.lastSubmitPromise = this.device.queue.onSubmittedWorkDone()
    return { submitMs: performance.now() - start, layerCount: renderedLayers }
  }

  async waitForGpu(): Promise<void> {
    await this.lastSubmitPromise
  }

  async toBlob(format: 'png' | 'jpeg' | 'webp', quality = 100): Promise<Blob> {
    await this.waitForGpu()
    const mimeType = format === 'png' ? 'image/png' : `image/${format}`
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(
      resolve,
      mimeType,
      Math.max(0, Math.min(1, quality / 100)),
    ))
    if (!blob) throw new Error('无法读取 WebGPU 合成画面')
    return blob
  }

  async toPngBlob(): Promise<Blob> {
    return this.toBlob('png')
  }

  destroy(): void {
    for (const image of this.imageTextures.values()) image.texture.destroy()
    for (const video of this.videoTextures.values()) video.texture.destroy()
    for (const lut of this.lutTextures.values()) lut.texture.destroy()
    this.identityLut?.texture.destroy()
    this.imageTextures.clear()
    this.videoTextures.clear()
    this.lutTextures.clear()
    this.identityLut = null
    for (const buffer of this.uniformBuffers) buffer.destroy()
    this.uniformBuffers = []
    this.runtime?.destroy()
    this.runtime = null
    this.device = null
    this.context = null
    this.sampler = null
    this.format = null
    this.resolveImage = null
    this.resolveSource = null
    this.resolveLut = null
    this.pipelines.clear()
  }

  private setCanvasSize(width: number, height: number): void {
    if (!this.device || !this.context || !this.format) return
    if (this.canvas.width === width && this.canvas.height === height) return
    this.canvas.width = width
    this.canvas.height = height
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })
  }

  private async getImageTexture(path: string): Promise<CachedImageTexture> {
    if (!this.device || !this.resolveImage) throw new Error('WebGPU 图片渲染器尚未初始化')
    const cached = this.imageTextures.get(path)
    if (cached) return cached
    const source = await this.resolveImage(path)
    const { width, height } = getWebGpuSourceDimensions(source)
    if (width < 1 || height < 1) throw new Error(`图片尺寸无效: ${path}`)
    const texture = this.device.createTexture({
      label: `webgpu-composition-image:${path}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
    })
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture },
      { width, height },
    )
    const entry = { texture, view: texture.createView(), width, height }
    this.imageTextures.set(path, entry)
    return entry
  }

  private async getLayerTexture(layer: CompositionLayer): Promise<CachedImageTexture> {
    if (layer.source.sourceType !== 'video') return this.getImageTexture(layer.source.path)
    if (!this.device || !this.resolveSource) {
      throw new Error('WebGPU 视频图层缺少视频源')
    }

    const source = await this.resolveSource(layer)
    const { width, height } = getWebGpuSourceDimensions(source)
    if (width < 1 || height < 1) throw new Error(`视频尺寸无效: ${layer.source.path}`)

    const sourceKey = layer.source.key ?? layer.source.path
    let cached = this.videoTextures.get(sourceKey)
    if (!cached || cached.width !== width || cached.height !== height) {
      cached?.texture.destroy()
      const texture = this.device.createTexture({
        label: `webgpu-composition-video:${sourceKey}`,
        size: { width, height },
        format: 'rgba8unorm',
        usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
      })
      cached = { texture, view: texture.createView(), width, height }
      this.videoTextures.set(sourceKey, cached)
    }
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: cached.texture },
      { width, height },
    )
    return cached
  }

  private async getLayerLuts(layer: CompositionLayer): Promise<{ creative: CachedLutTexture; restore: CachedLutTexture | null }> {
    const intensity = Math.max(0, Math.min(100, layer.lutIntensity ?? 100))
    const creative = layer.lutId && intensity > 0
      ? await this.getLutTexture(layer.lutId)
      : this.getIdentityLut()
    const restore = layer.restoreLutId
      ? await this.getLutTexture(layer.restoreLutId)
      : null
    return { creative, restore }
  }

  private async getLutTexture(path: string): Promise<CachedLutTexture> {
    if (!this.device || !this.resolveLut) throw new Error('WebGPU 合成渲染器缺少 LUT 加载器')

    const cached = this.lutTextures.get(path)
    if (cached) return cached

    const parsed = parseWebGpuLut(await this.resolveLut(path))
    const texture = this.createLutTexture(`webgpu-composition-lut:${path}`, parsed)
    const entry: CachedLutTexture = {
      ...parsed,
      texture,
      view: texture.createView({ dimension: '3d' }),
    }
    this.lutTextures.set(path, entry)
    return entry
  }

  private getIdentityLut(): CachedLutTexture {
    if (this.identityLut) return this.identityLut
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const parsed = identityWebGpuLut()
    const texture = this.createLutTexture('webgpu-composition-lut:identity', parsed)
    this.identityLut = {
      ...parsed,
      texture,
      view: texture.createView({ dimension: '3d' }),
    }
    return this.identityLut
  }

  private createLutTexture(label: string, lut: WebGpuLutData): GPUTexture {
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const texture = this.device.createTexture({
      label,
      size: { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
      format: 'rgba8unorm',
      dimension: '3d',
      usage: WEBGPU_FLAGS.textureBinding | WEBGPU_FLAGS.textureCopyDst,
    })
    const upload = paddedLutData(lut)
    this.device.queue.writeTexture(
      { texture },
      upload.data,
      { bytesPerRow: upload.bytesPerRow, rowsPerImage: lut.size },
      { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
    )
    return texture
  }

  private ensureUniformBuffer(index: number): GPUBuffer {
    if (!this.device) throw new Error('WebGPU 合成渲染器尚未初始化')
    const existing = this.uniformBuffers[index]
    if (existing) return existing
    const buffer = this.device.createBuffer({
      label: `webgpu-composition-uniforms-${index}`,
      size: 112,
      usage: WEBGPU_FLAGS.bufferUniform | WEBGPU_FLAGS.bufferCopyDst,
    })
    this.uniformBuffers[index] = buffer
    return buffer
  }
}
