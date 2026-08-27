import { useEffect, useRef } from 'react'

import type { PreviewLayer, RenderColorAdjustments } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import './WebGpuVideoPreview.css'

interface WebGpuAdapter {
  requestDevice(): Promise<WebGpuDevice>
}

interface WebGpuNavigator {
  requestAdapter(): Promise<WebGpuAdapter | null>
  getPreferredCanvasFormat(): string
}

interface WebGpuDevice {
  createShaderModule(descriptor: { code: string }): unknown
  createRenderPipeline(descriptor: unknown): WebGpuRenderPipeline
  createSampler(descriptor: unknown): unknown
  createBuffer(descriptor: { size: number; usage: number }): WebGpuBuffer
  importExternalTexture(options: { source: HTMLVideoElement }): unknown
  createBindGroup(descriptor: unknown): unknown
  createCommandEncoder(): WebGpuCommandEncoder
  queue: {
    writeBuffer(buffer: WebGpuBuffer, offset: number, data: ArrayBufferView): void
    submit(commandBuffers: unknown[]): void
  }
  lost: Promise<{ reason?: string; message?: string }>
}

interface WebGpuBuffer {}

interface WebGpuRenderPipeline {
  getBindGroupLayout(index: number): unknown
}

interface WebGpuCommandEncoder {
  beginRenderPass(descriptor: unknown): WebGpuRenderPass
  finish(): unknown
}

interface WebGpuRenderPass {
  setPipeline(pipeline: WebGpuRenderPipeline): void
  setBindGroup(index: number, bindGroup: unknown): void
  draw(vertexCount: number): void
  end(): void
}

interface WebGpuCanvasContext {
  configure(descriptor: { device: WebGpuDevice; format: string; alphaMode: 'opaque'; usage?: number }): void
  getCurrentTexture(): { createView(): unknown }
}

interface WebGpuPreviewProps {
  layers: PreviewLayer[]
  canvasWidth: number
  canvasHeight: number
  active?: boolean
  playing: boolean
  className?: string
  onVideoElement?: (element: HTMLMediaElement | null) => void
  onFallback: (reason: string) => void
  onRender?: () => void
}

const GPU_BUFFER_USAGE_COPY_DST = 0x08
const GPU_BUFFER_USAGE_UNIFORM = 0x40

const WEBGPU_SHADER = `
struct PreviewUniforms {
  destination: vec4f,
  source: vec4f,
  color: vec4f,
  opacity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: PreviewUniforms;
@group(0) @binding(1) var videoSampler: sampler;
@group(0) @binding(2) var videoTexture: texture_external;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  var unitPositions = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );
  let unit = unitPositions[index];
  let destination = uniforms.destination;
  let source = uniforms.source;
  var output: VertexOutput;
  output.position = vec4f(
    mix(destination.x, destination.z, unit.x),
    mix(destination.y, destination.w, unit.y),
    0.0,
    1.0
  );
  output.uv = source.xy + unit * source.zw;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var color = textureSampleBaseClampToEdge(videoTexture, videoSampler, input.uv);
  color.rgb = color.rgb * pow(vec3f(2.0), vec3f(uniforms.color.x));
  color.rgb = color.rgb + vec3f(uniforms.color.y);
  color.rgb = (color.rgb - vec3f(0.5)) * (vec3f(1.0) + vec3f(uniforms.color.z)) + vec3f(0.5);
  let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  color.rgb = mix(vec3f(luminance), color.rgb, vec3f(1.0) + vec3f(uniforms.color.w));
  return vec4f(clamp(color.rgb, vec3f(0.0), vec3f(1.0)), color.a * uniforms.opacity);
}
`

function webGpuNavigator(): WebGpuNavigator | null {
  const gpu = (navigator as Navigator & { gpu?: WebGpuNavigator }).gpu
  return gpu ?? null
}

function numberIsNeutral(value: unknown, fallback = 0): boolean {
  return typeof value !== 'number' || Math.abs(value - fallback) < 0.000001
}

function colorIsNeutral(color: RenderColorAdjustments | undefined): boolean {
  if (!color) return true
  const zeroFields: Array<keyof RenderColorAdjustments> = [
    'exposure', 'black', 'brightness', 'contrast', 'saturation', 'vibrance',
    'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks',
    'clarity', 'texture', 'sharpen', 'denoise', 'skinSmoothing',
    'glowStrength', 'gradeShadowsAmount', 'gradeMidAmount', 'gradeHighlightsAmount',
    'curveLift', 'curveContrast',
  ]
  if (zeroFields.some((field) => !numberIsNeutral(color[field]))) return false
  if (!numberIsNeutral(color.levelsBlack) || !numberIsNeutral(color.levelsGray, 0.5) || !numberIsNeutral(color.levelsWhite, 1)) return false
  if (!numberIsNeutral(color.glowRadius, 35) || !numberIsNeutral(color.glowThreshold, 65)) return false
  const curves = color.curve
    ? Object.values(color.curve) as Array<Array<{ x: number; y: number }>>
    : []
  if (curves.some((points) => points.some((point) => Math.abs(point.x - point.y) > 0.000001))) {
    return false
  }
  if (color.hslChannels?.some((channel) => (
    !numberIsNeutral(channel.hueShift)
    || !numberIsNeutral(channel.saturation)
    || !numberIsNeutral(channel.luminance)
  ))) return false
  return true
}

function transformIsNeutral(layer: PreviewLayer): boolean {
  const transform = layer.transform
  if (!transform) return true
  return transform.crop == null
    && numberIsNeutral(transform.orientation)
    && numberIsNeutral(transform.rotate)
    && transform.flipH === false
    && transform.flipV === false
    && numberIsNeutral(transform.scale, 1)
    && numberIsNeutral(transform.translateX)
    && numberIsNeutral(transform.translateY)
}

/**
 * Keep the experimental backend explicit. Effects not represented by this
 * first shader continue through the established Rust compositor.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function canUseWebGpuVideoPreview(layers: PreviewLayer[]): boolean {
  if (layers.length !== 1) return false
  const [layer] = layers
  if (!layer.isVideo || (layer.layerType && layer.layerType !== 'media')) return false
  if (layer.maskPath || layer.maskTimeline || layer.maskTrack || layer.pixelStretch || layer.pixelFlow) return false
  if (layer.positioning || layer.reveal || layer.precomposeGroup || layer.precomposeRole) return false
  if (layer.videoTime != null && Math.abs(layer.videoTime) > 0.000001) return false
  if (layer.videoOffset != null && Math.abs(layer.videoOffset) > 0.000001) return false
  if (layer.videoDuration != null || layer.activeStart != null || layer.activeEnd != null) return false
  if (layer.lutId || layer.restoreLutId || !colorIsNeutral(layer.color)) return false
  if (!transformIsNeutral(layer)) return false
  if (layer.blendMode && layer.blendMode !== 'normal') return false
  return true
}

function destinationNdc(layer: PreviewLayer): [number, number, number, number] {
  const left = (layer.dstX ?? 0) * 2 - 1
  const right = ((layer.dstX ?? 0) + (layer.dstW ?? 1)) * 2 - 1
  const top = 1 - (layer.dstY ?? 0) * 2
  const bottom = 1 - ((layer.dstY ?? 0) + (layer.dstH ?? 1)) * 2
  return [left, top, right, bottom]
}

function sourceRect(layer: PreviewLayer): [number, number, number, number] {
  return [layer.srcX ?? 0, layer.srcY ?? 0, layer.srcW ?? 1, layer.srcH ?? 1]
}

function colorUniform(layer: PreviewLayer): [number, number, number, number] {
  const color = layer.color
  return [color?.exposure ?? 0, color?.brightness ?? 0, color?.contrast ?? 0, color?.saturation ?? 0]
}

function formatGpuError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function WebGpuVideoPreview({
  layers,
  canvasWidth,
  canvasHeight,
  active = true,
  playing,
  className,
  onVideoElement,
  onFallback,
  onRender,
}: WebGpuPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const deviceRef = useRef<WebGpuDevice | null>(null)
  const contextRef = useRef<WebGpuCanvasContext | null>(null)
  const pipelineRef = useRef<WebGpuRenderPipeline | null>(null)
  const samplerRef = useRef<unknown>(null)
  const uniformBufferRef = useRef<WebGpuBuffer | null>(null)
  const frameCallbackRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const destroyedRef = useRef(false)
  const readyRef = useRef(false)
  const renderingRef = useRef(false)
  const queuedRenderRef = useRef(false)
  const reportedFailureRef = useRef(false)
  const layerRef = useRef(layers[0])
  const propsRef = useRef({ active, playing, onFallback, onRender, onVideoElement })
  layerRef.current = layers[0]
  propsRef.current = { active, playing, onFallback, onRender, onVideoElement }

  function reportFailure(error: unknown): void {
    if (destroyedRef.current || reportedFailureRef.current) return
    reportedFailureRef.current = true
    propsRef.current.onFallback(formatGpuError(error))
  }

  function cancelFrameScheduling(): void {
    const video = videoRef.current
    if (frameCallbackRef.current !== null) {
      video?.cancelVideoFrameCallback?.(frameCallbackRef.current)
      frameCallbackRef.current = null
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }

  function scheduleRender(): void {
    if (destroyedRef.current || !readyRef.current || animationFrameRef.current !== null) return
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null
      void renderFrame()
    })
  }

  function scheduleVideoFrame(): void {
    const video = videoRef.current
    if (destroyedRef.current || !readyRef.current || !video || !propsRef.current.playing) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      if (frameCallbackRef.current !== null) return
      frameCallbackRef.current = video.requestVideoFrameCallback(() => {
        frameCallbackRef.current = null
        scheduleRender()
        scheduleVideoFrame()
      })
      return
    }
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null
        void renderFrame()
        scheduleVideoFrame()
      })
    }
  }

  async function renderFrame(): Promise<void> {
    const device = deviceRef.current
    const context = contextRef.current
    const pipeline = pipelineRef.current
    const sampler = samplerRef.current
    const uniformBuffer = uniformBufferRef.current
    const video = videoRef.current
    const layer = layerRef.current
    if (destroyedRef.current || !device || !context || !pipeline || !sampler || !uniformBuffer || !video || !layer) return
    if (renderingRef.current) {
      queuedRenderRef.current = true
      return
    }
    renderingRef.current = true
    queuedRenderRef.current = false
    try {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      const uniforms = new Float32Array(16)
      uniforms.set(destinationNdc(layer), 0)
      uniforms.set(sourceRect(layer), 4)
      uniforms.set(colorUniform(layer), 8)
      uniforms[12] = layer.opacity ?? 1
      device.queue.writeBuffer(uniformBuffer, 0, uniforms)
      const externalTexture = device.importExternalTexture({ source: video })
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: uniformBuffer },
          { binding: 1, resource: sampler },
          { binding: 2, resource: externalTexture },
        ],
      })
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(6)
      pass.end()
      device.queue.submit([encoder.finish()])
      propsRef.current.onRender?.()
    } catch (error) {
      reportFailure(error)
    } finally {
      renderingRef.current = false
      if (queuedRenderRef.current && !destroyedRef.current) scheduleRender()
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasElement = canvas
    destroyedRef.current = false
    let cancelled = false

    async function initialize(): Promise<void> {
      try {
        const gpu = webGpuNavigator()
        if (!gpu) throw new Error('当前系统不支持加速预览')
        const adapter = await gpu.requestAdapter()
        if (!adapter) throw new Error('当前系统没有可用的图形设备')
        const device = await adapter.requestDevice()
        if (cancelled || destroyedRef.current) return
        const context = (canvasElement.getContext as unknown as (contextId: string) => unknown)('webgpu') as WebGpuCanvasContext | null
        if (!context) throw new Error('无法创建加速预览画布')
        const format = gpu.getPreferredCanvasFormat()
        context.configure({ device, format, alphaMode: 'opaque' })
        const shader = device.createShaderModule({ code: WEBGPU_SHADER })
        const pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: shader, entryPoint: 'vertexMain' },
          fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        })
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
        const uniformBuffer = device.createBuffer({
          size: 64,
          usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST,
        })
        deviceRef.current = device
        contextRef.current = context
        pipelineRef.current = pipeline
        samplerRef.current = sampler
        uniformBufferRef.current = uniformBuffer
        readyRef.current = true
        device.lost.then((info) => {
          if (!cancelled && !destroyedRef.current) reportFailure(info.message || `图形设备已停止工作: ${info.reason || 'unknown'}`)
        }).catch((error) => reportFailure(error))
        const video = document.createElement('video')
        video.preload = 'auto'
        video.playsInline = true
        video.loop = false
        video.muted = false
        video.src = filePathToPreviewUrl(layerRef.current?.filePath) ?? layerRef.current?.filePath ?? ''
        video.addEventListener('loadedmetadata', () => {
          if (destroyedRef.current) return
          video.currentTime = layerRef.current?.videoTime ?? 0
          propsRef.current.onVideoElement?.(video)
          scheduleRender()
          if (propsRef.current.playing) void video.play().catch(reportFailure)
        })
        video.addEventListener('loadeddata', () => scheduleRender())
        video.addEventListener('seeked', () => scheduleRender())
        video.addEventListener('play', scheduleVideoFrame)
        video.addEventListener('pause', cancelFrameScheduling)
        video.addEventListener('ended', cancelFrameScheduling)
        video.addEventListener('error', () => {
          if (video.error?.code !== MediaError.MEDIA_ERR_ABORTED) {
            reportFailure(`视频无法用于加速预览: ${video.error?.message || '未知错误'}`)
          }
        })
        videoRef.current = video
        video.load()
      } catch (error) {
        reportFailure(error)
      }
    }

    void initialize()
    return () => {
      cancelled = true
      destroyedRef.current = true
      readyRef.current = false
      cancelFrameScheduling()
      const video = videoRef.current
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      propsRef.current.onVideoElement?.(null)
      videoRef.current = null
      deviceRef.current = null
      contextRef.current = null
      pipelineRef.current = null
      samplerRef.current = null
      uniformBufferRef.current = null
    }
    // Backend resources are recreated only when this component is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !readyRef.current) return
    if (!active || !playing) {
      video.pause()
      if (!active) scheduleRender()
      return
    }
    void video.play().then(scheduleVideoFrame).catch(reportFailure)
    // These functions use refs and are intentionally stable for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, playing])

  useEffect(() => {
    layerRef.current = layers[0]
    if (readyRef.current) scheduleRender()
    // These functions use refs and are intentionally stable for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers])

  return (
    <canvas
      ref={canvasRef}
      className={['webgpu-video-preview', className].filter(Boolean).join(' ')}
      width={canvasWidth}
      height={canvasHeight}
      aria-label="视频预览"
    />
  )
}
