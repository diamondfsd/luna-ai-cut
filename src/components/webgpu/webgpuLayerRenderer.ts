import type { PreviewLayer, RenderLayerTransform } from '../../shared/types'
import { createLayerParams, layerRevealProgress, planCoverScale, planCoverTransform, positioningFor, resolvePositioning, numberOr } from './webgpuLayerMath'
import { BUFFER_USAGE_UNIFORM, PARAM_FLOAT_COUNT } from './webgpuGpu'
import { WebGpuResourceManager } from './webgpuResources'
import type { GpuBuffer, GpuDevice, GpuImageResource, GpuPipeline, GpuSampler, GpuTextureView } from './webgpuTypes'

export interface WebGpuLayerRendererCallbacks {
  getDevice: () => GpuDevice | null
  getSampler: () => GpuSampler | null
  getBindGroupLayout: () => object | null
  isHdrPresentationEnabled: () => boolean
  pipelineFor: (blendMode: PreviewLayer['blendMode']) => GpuPipeline
}

export class WebGpuLayerRenderer {
  private readonly callbacks: WebGpuLayerRendererCallbacks
  private readonly resources: WebGpuResourceManager
  private readonly paramsBuffers = new Map<number, GpuBuffer>()

  constructor(callbacks: WebGpuLayerRendererCallbacks, resources: WebGpuResourceManager) {
    this.callbacks = callbacks
    this.resources = resources
  }

  async drawLayers(
    layers: PreviewLayer[],
    targetView: GpuTextureView,
    canvasWidth: number,
    canvasHeight: number,
    time: number,
    overrides: Map<string, GpuImageResource>,
  ): Promise<void> {
    const device = this.callbacks.getDevice()
    const sampler = this.callbacks.getSampler()
    const layout = this.callbacks.getBindGroupLayout()
    if (!device || !sampler || !layout) throw new Error('WebGPU 绘制对象未初始化')
    const encoder = device.createCommandEncoder({ label: 'luna-webgpu-preview' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    pass.setViewport(0, 0, canvasWidth, canvasHeight, 0, 1)
    pass.setScissorRect(0, 0, canvasWidth, canvasHeight)
    const sortedLayers = [...layers]
      .filter((layer) => (layer.activeStart == null || time >= layer.activeStart) && (layer.activeEnd == null || time < layer.activeEnd))
      .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
    for (let index = 0; index < sortedLayers.length; index += 1) {
      const layer = sortedLayers[index]
      if (layer.isVideo && !this.resources.hasReadyVideo(layer)) continue
      const layerResources = await this.resources.layerResources(layer, time, overrides, canvasWidth, canvasHeight)
      const positioning = positioningFor(layer.positioning, canvasWidth, canvasHeight)
      const sourceTransform: RenderLayerTransform = layer.transform ?? {
        crop: null,
        orientation: 0,
        rotate: 0,
        flipH: false,
        flipV: false,
        scale: 1,
        translateX: 0,
        translateY: 0,
      }
      let plannedTransform = planCoverTransform(
        layer,
        sourceTransform,
        layerResources.source.width,
        layerResources.source.height,
        canvasWidth,
        canvasHeight,
        positioning,
      )
      const fallbackRect: [number, number, number, number] = [
        numberOr(layer.dstX, 0), numberOr(layer.dstY, 0), numberOr(layer.dstW, 1), numberOr(layer.dstH, 1),
      ]
      const resolvedRect = resolvePositioning(
        positioning,
        fallbackRect,
        canvasWidth,
        canvasHeight,
        layerResources.source.width,
        layerResources.source.height,
      )
      let frame: [number, number] | undefined
      if (layer.fit === 'cover-scale') {
        const targetAspect = Math.max(0.001, (resolvedRect[2] * canvasWidth) / Math.max(1, resolvedRect[3] * canvasHeight))
        const scaled = planCoverScale(plannedTransform, layerResources.source.width, layerResources.source.height, targetAspect)
        plannedTransform = scaled.transform
        frame = scaled.frame
      }
      const params = createLayerParams(
        layer,
        layerResources.source.width,
        layerResources.source.height,
        canvasWidth,
        canvasHeight,
        layerResources.maskPresent,
        layerResources.maskTransform,
        layerRevealProgress(layer, time),
        plannedTransform,
        resolvedRect,
        frame,
        layerResources.restoreLut.size,
        layerResources.lut.size,
        time,
        this.callbacks.isHdrPresentationEnabled(),
      )
      const paramsBuffer = this.bufferForLayer(device, index)
      device.queue.writeBuffer(paramsBuffer, 0, params)
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: layerResources.source.texture.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: paramsBuffer } },
          { binding: 3, resource: layerResources.lut.texture.createView({ dimension: '3d' }) },
          { binding: 4, resource: sampler },
          { binding: 5, resource: layerResources.mask.texture.createView() },
          { binding: 6, resource: layerResources.restoreLut.texture.createView({ dimension: '3d' }) },
        ],
      })
      pass.setPipeline(this.callbacks.pipelineFor(layer.blendMode))
      pass.setBindGroup(0, bindGroup)
      pass.draw(4, 1, 0, 0)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  destroy(): void {
    for (const buffer of this.paramsBuffers.values()) buffer.destroy?.()
    this.paramsBuffers.clear()
  }

  private bufferForLayer(device: GpuDevice, index: number): GpuBuffer {
    const cached = this.paramsBuffers.get(index)
    if (cached) return cached
    const buffer = device.createBuffer({ size: PARAM_FLOAT_COUNT * 4, usage: BUFFER_USAGE_UNIFORM | 0x08 })
    this.paramsBuffers.set(index, buffer)
    return buffer
  }
}
