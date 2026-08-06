import type { TimelineItem } from '@freecut/types/timeline'
import { createLogger } from '@freecut/shared/logging/logger'
import { getCompositeOperation } from '@freecut/types/blend-mode-css'
import { doesMaskAffectTrack } from '@freecut/shared/utils/mask-scope'
import { hasCornerPin, type FrameRenderTask } from '@freecut/features/export/deps/composition-runtime'
import { DEFAULT_LAYER_PARAMS, type CompositeLayer } from '@freecut/infrastructure/gpu-compositor'
import { applyMasks, type MaskCanvasSettings, type PreparedMask } from './canvas-masks'
import type { ActiveTransition } from './canvas-transitions'
import type { CanvasPool } from './canvas-pool'
import type { CanvasSettings, ItemRenderContext } from './canvas-item-renderer'
import type { GpuPipelineManager } from './gpu-pipeline-manager'
import type { RenderedTaskResult } from './frame-mask-helpers'

function getLog() {
  return createLogger('ClientRenderEngine')
}

export interface FrameCompositingDeps {
  useGpuCompositor: boolean
  gpu: GpuPipelineManager
  gpuCompositeOutput: { canvas: OffscreenCanvas; ctx: GPUCanvasContext } | null
  canvasSettings: CanvasSettings
  maskSettings: MaskCanvasSettings
  renderTasks: FrameRenderTask<ActiveTransition>[]
  results: Array<RenderedTaskResult | null>
  activeMasks: PreparedMask[]
  contentCanvas: OffscreenCanvas
  contentCtx: OffscreenCanvasRenderingContext2D
  itemRenderContext: ItemRenderContext
  canvasPool: CanvasPool
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getEffectiveBlendMode: (item: TimelineItem) => TimelineItem['blendMode']
  applyTrackScopedMasks: (
    result: RenderedTaskResult | null,
    trackOrder: number,
    skipMasks: boolean,
  ) => RenderedTaskResult | null
  renderMasksToGpuTexture: (
    masks: PreparedMask[],
  ) => { texture: GPUTexture; view: GPUTextureView } | null
  renderTransitionFallbackCanvas: (
    task: Extract<FrameRenderTask<ActiveTransition>, { type: 'transition' }>,
  ) => Promise<RenderedTaskResult>
  renderItemWithEffects: (
    baseItem: TimelineItem,
    trackOrder: number,
    deferred: boolean,
    targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    bakeMasks?: boolean,
    preferGpuTextureOutput?: boolean,
    allowDirectGpu?: boolean,
  ) => Promise<RenderedTaskResult | null>
}

/**
 * Composites all per-task render results in z-order and returns the canvas to
 * blit to the output. Uses the WebGPU blend-mode compositor when available
 * (pixel-perfect blend modes), falling back to Canvas2D `globalCompositeOperation`
 * when the GPU target isn't usable for the frame. Manages pooled GPU-texture and
 * canvas lifetimes. Extracted verbatim from `renderFrame`.
 *
 * NOTE: the WebGPU path is not exercised by the jsdom test suite — verify export
 * and preview output visually after changing this function.
 */
export async function compositeFrameResults(deps: FrameCompositingDeps): Promise<OffscreenCanvas> {
  const {
    useGpuCompositor,
    gpu,
    gpuCompositeOutput,
    canvasSettings,
    maskSettings,
    renderTasks,
    results,
    activeMasks,
    contentCanvas,
    contentCtx,
    itemRenderContext,
    canvasPool,
    getCurrentItem,
    getEffectiveBlendMode,
    applyTrackScopedMasks,
    renderMasksToGpuTexture,
    renderTransitionFallbackCanvas,
    renderItemWithEffects,
  } = deps

  let finalCompositeSource: OffscreenCanvas = contentCanvas

  // Composite all results in z-order (preserved by renderTasks ordering)
  if (useGpuCompositor && gpu.compositor && gpu.maskManager && gpuCompositeOutput) {
    // GPU compositing path — pixel-perfect blend modes via WebGPU
    const device = gpu.effects!.getDevice()
    const w = canvasSettings.width
    const h = canvasSettings.height
    const layers: CompositeLayer[] = []
    const layerTextures: GPUTexture[] = []
    const layerMaskTextures: GPUTexture[] = []
    const compositedResults: Array<{
      task: (typeof renderTasks)[number]
      result: RenderedTaskResult
      fallbackMasks: typeof activeMasks
    }> = []

    try {
      for (let i = 0; i < results.length; i++) {
        const task = renderTasks[i]!
        const taskHasCornerPin =
          task.type === 'item'
            ? hasCornerPin(getCurrentItem(task.item).cornerPin)
            : hasCornerPin(getCurrentItem(task.transition.leftClip).cornerPin) ||
              hasCornerPin(getCurrentItem(task.transition.rightClip).cornerPin)
        const applicableMasks = activeMasks.filter((mask) =>
          doesMaskAffectTrack(mask.trackOrder, task.trackOrder),
        )
        const shouldUseSeparateMask = task.type === 'item' && !taskHasCornerPin
        let result: RenderedTaskResult | null = shouldUseSeparateMask
          ? (results[i] ?? null)
          : applyTrackScopedMasks(results[i] ?? null, task.trackOrder, taskHasCornerPin)
        if (!result) continue

        let maskInfo =
          shouldUseSeparateMask && applicableMasks.length > 0
            ? renderMasksToGpuTexture(applicableMasks)
            : null
        if (maskInfo) layerMaskTextures.push(maskInfo.texture)
        let fallbackMasks = shouldUseSeparateMask ? applicableMasks : []
        if (shouldUseSeparateMask && applicableMasks.length > 0 && !maskInfo) {
          const maskedResult = applyTrackScopedMasks(result, task.trackOrder, false)
          if (!maskedResult) continue
          result = maskedResult
          fallbackMasks = []
        }

        const blendMode =
          task.type === 'item'
            ? (getEffectiveBlendMode(getCurrentItem(task.item)) ?? 'normal')
            : 'normal'

        // Upload item canvas to GPU texture (pooled — no per-frame alloc)
        let tex = result.gpuTexture
        if (!tex) {
          if (!result.source) continue
          tex = gpu.texturePool!.acquire(w, h)
          layerTextures.push(tex)
          device.queue.copyExternalImageToTexture(
            { source: result.source, flipY: false },
            { texture: tex },
            { width: w, height: h },
          )
        } else {
          layerTextures.push(tex)
        }

        compositedResults.push({
          task,
          result,
          fallbackMasks,
        })

        layers.push({
          params: {
            ...DEFAULT_LAYER_PARAMS,
            blendMode,
            sourceAspect: w / h,
            outputAspect: w / h,
            hasMask: Boolean(maskInfo),
          },
          textureView: tex.createView(),
          maskView: maskInfo?.view ?? gpu.maskManager.getFallbackView(),
        })
      }

      let compositedToGpuCanvas = false
      if (layers.length > 0) {
        try {
          compositedToGpuCanvas = gpu.compositor.compositeToCanvas(
            layers,
            w,
            h,
            gpuCompositeOutput.ctx,
          )
        } catch (error) {
          getLog().warn('GPU compositor failed - using Canvas2D blend fallback', {
            error,
          })
        }
      }

      if (compositedToGpuCanvas) {
        await itemRenderContext.gpuPipeline?.waitForSubmittedWork()
        finalCompositeSource = gpuCompositeOutput.canvas
      } else {
        // Fall back to the established Canvas2D compositor if the GPU target
        // isn't available for this frame. This preserves feature parity and
        // avoids dropping content when WebGPU canvas presentation fails.
        for (const { task, result, fallbackMasks } of compositedResults) {
          let fallbackResult = result
          if (!fallbackResult.source && task.type === 'transition') {
            fallbackResult = await renderTransitionFallbackCanvas(task)
          }
          if (!fallbackResult.source && task.type === 'item') {
            const rerenderedFallback = await renderItemWithEffects(
              task.item,
              task.trackOrder,
              true,
              contentCtx,
              true,
              false,
              false,
            )
            if (!rerenderedFallback) continue
            fallbackResult = rerenderedFallback
          }
          let fallbackSource = fallbackResult.source
          if (!fallbackSource) continue
          if (fallbackMasks.length > 0) {
            const { canvas: fallbackMaskedCanvas, ctx: fallbackMaskedCtx } = canvasPool.acquire()
            applyMasks(fallbackMaskedCtx, fallbackSource, fallbackMasks, maskSettings)
            // Carry prior pool canvases forward only when `fallbackResult` is a
            // re-render (≠ `result`): those canvases are invisible to the outer
            // cleanup loop. When it's still the original `result`, the outer loop
            // already releases `result.poolCanvases`, so spreading them here would
            // double-release the same backing buffer.
            const carriedPoolCanvases = fallbackResult === result ? [] : fallbackResult.poolCanvases
            fallbackResult = {
              source: fallbackMaskedCanvas,
              poolCanvases: [...carriedPoolCanvases, fallbackMaskedCanvas],
            }
            fallbackSource = fallbackMaskedCanvas
          }
          const blendMode =
            task.type === 'item' ? getEffectiveBlendMode(getCurrentItem(task.item)) : undefined
          if (blendMode && blendMode !== 'normal') {
            contentCtx.globalCompositeOperation = getCompositeOperation(blendMode)
          }

          contentCtx.drawImage(fallbackSource, 0, 0)

          if (blendMode && blendMode !== 'normal') {
            contentCtx.globalCompositeOperation = 'source-over'
          }
          if (fallbackResult !== result) {
            for (const c of fallbackResult.poolCanvases) canvasPool.release(c)
          }
        }
      }
    } finally {
      const releasedCanvases = new Set<OffscreenCanvas>()
      for (const result of results) {
        if (!result) continue
        for (const canvas of result.poolCanvases) {
          if (releasedCanvases.has(canvas)) continue
          releasedCanvases.add(canvas)
          canvasPool.release(canvas)
        }
      }
      // Always return pooled resources, including when upload, compositing, or
      // fallback rendering throws. Otherwise the pool permanently treats them
      // as in-use and allocates replacements on every later frame.
      for (const texture of new Set(layerTextures)) gpu.texturePool!.release(texture)
      for (const texture of new Set(layerMaskTextures)) gpu.texturePool!.release(texture)
    }
  } else {
    // Canvas2D compositing fallback
    for (let i = 0; i < results.length; i++) {
      const task = renderTasks[i]!
      const result = applyTrackScopedMasks(
        results[i] ?? null,
        task.trackOrder,
        task.type === 'item'
          ? hasCornerPin(getCurrentItem(task.item).cornerPin)
          : hasCornerPin(getCurrentItem(task.transition.leftClip).cornerPin) ||
              hasCornerPin(getCurrentItem(task.transition.rightClip).cornerPin),
      )
      if (!result) continue
      if (!result.source) {
        if (result.gpuTexture) gpu.texturePool?.release(result.gpuTexture)
        continue
      }

      const blendMode =
        task.type === 'item' ? getEffectiveBlendMode(getCurrentItem(task.item)) : undefined
      if (blendMode && blendMode !== 'normal') {
        contentCtx.globalCompositeOperation = getCompositeOperation(blendMode)
      }

      contentCtx.drawImage(result.source, 0, 0)

      if (blendMode && blendMode !== 'normal') {
        contentCtx.globalCompositeOperation = 'source-over'
      }

      for (const c of result.poolCanvases) canvasPool.release(c)
    }
  }

  return finalCompositeSource
}
