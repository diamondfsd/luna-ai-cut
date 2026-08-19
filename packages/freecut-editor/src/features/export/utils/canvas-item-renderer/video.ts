/**
 * Video item rendering: mediabunny extractor, DOM video fallback, and
 * worker-predecoded bitmap fast path.
 */

import type { VideoItem } from '@freecut/types/timeline'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  getSourceFrameRampOffset,
  isFrameInsideSourceTimeRamp,
  type RenderTimelineSpan,
} from '../render-span'
import {
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
  waitForPreviewDomVideoDrawDecision,
} from '../frame-source-policy'
import type { CanvasPool } from '../canvas-pool'
import type { CanvasSettings, ItemRenderContext, ItemTransform } from './types'
import {
  isFrameInsideItemTimelineSpan,
  log,
  TIER2_VIDEO_FRAME_TOLERANCE_FACTOR,
  WORKER_PRESEEK_WAIT_MS,
} from './shared'
import {
  applyCropFeatherMask,
  calculateContainedMediaDrawLayout,
  clipToViewport,
  drawContainedMediaSource,
  hasCropFeather,
} from './media-draw'
import { isPreviewTraceEnabled, recordRenderTrace } from '@freecut/shared/logging/preview-trace'
import { recordPreviewVideoSource } from '@freecut/shared/logging/preview-scrub-performance'

function getTier2VideoFrameToleranceSeconds(sourceFps: number): number {
  const normalizedSourceFps = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30
  return (1 / normalizedSourceFps) * TIER2_VIDEO_FRAME_TOLERANCE_FACTOR
}

function canUseWorkerPredecodedFrame(
  rctx: ItemRenderContext,
  workerSource: string | null | undefined,
): boolean {
  if (!workerSource) return false
  return rctx.renderMode === 'preview' || rctx.allowPredecodedVideoFrames === true
}

function tryDrawActivePreviewFallback(options: {
  rctx: ItemRenderContext
  previewRootFrame: number
  workerSource: string
  sourceTime: number
  toleranceSeconds: number
  drawBitmap: (bitmap: ImageBitmap) => boolean
  timelineFrame: number
  itemId: string
  allowOutsideActivePreview?: boolean
}): boolean {
  const { rctx, previewRootFrame, workerSource, sourceTime, toleranceSeconds, drawBitmap } = options
  if (
    !options.allowOutsideActivePreview &&
    !rctx.isActivePreviewFrameCurrent?.(previewRootFrame)
  )
    return false
  const bitmap = rctx.getCachedActivePreviewFallbackBitmap?.(
    workerSource,
    sourceTime,
    toleranceSeconds,
  )
  if (!bitmap || !drawBitmap(bitmap)) return false
  rctx.markActivePreviewFallbackUsed?.()
  recordPreviewVideoSource({
    frame: options.timelineFrame,
    itemId: options.itemId,
    path: 'proxy-fallback',
    sourceTime,
  })
  return true
}

interface WorkerBitmapDrawOptions {
  rctx: ItemRenderContext
  workerSource: string
  sourceTime: number
  toleranceSeconds: number
  drawBitmap: (bitmap: ImageBitmap) => boolean
  timelineFrame: number
  itemId: string
}

function tryDrawCachedWorkerBitmap(options: WorkerBitmapDrawOptions): boolean {
  const bitmap = options.rctx.getCachedPredecodedBitmap?.(
    options.workerSource,
    options.sourceTime,
    options.toleranceSeconds,
  )
  if (!bitmap || !options.drawBitmap(bitmap)) return false
  recordPreviewVideoSource({
    frame: options.timelineFrame,
    itemId: options.itemId,
    path: 'worker-bitmap',
    sourceTime: options.sourceTime,
  })
  return true
}

async function tryDrawInflightWorkerBitmap(
  options: WorkerBitmapDrawOptions & { previewRootFrame: number },
): Promise<boolean> {
  const waitForBitmap = options.rctx.waitForInflightPredecodedBitmap
  if (!waitForBitmap) return false
  const maxWaitMs = options.rctx.isActivePreviewFrameCurrent?.(options.previewRootFrame)
    ? WORKER_PRESEEK_WAIT_MS
    : (options.rctx.workerPredecodeWaitMs ?? WORKER_PRESEEK_WAIT_MS)
  const bitmap = await waitForBitmap(
    options.workerSource,
    options.sourceTime,
    options.toleranceSeconds,
    maxWaitMs,
  )
  if (!bitmap || !options.drawBitmap(bitmap)) return false
  recordPreviewVideoSource({
    frame: options.timelineFrame,
    itemId: options.itemId,
    path: 'worker-bitmap',
    sourceTime: options.sourceTime,
  })
  return true
}

function clampVideoSourceTime(
  sourceTime: number,
  sourceFps: number,
  sourceDurationFrames: number | undefined,
): number {
  const clampedToStart = Math.max(0, sourceTime)
  if (
    sourceDurationFrames === undefined ||
    !Number.isFinite(sourceDurationFrames) ||
    sourceDurationFrames <= 0
  ) {
    return clampedToStart
  }

  const lastFrame = Math.max(0, sourceDurationFrames - 1)
  const maxTime = (lastFrame + 1e-4) / sourceFps
  return Math.min(clampedToStart, maxTime)
}

function drawTier2VideoFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ImageBitmap | VideoFrame,
  sourceWidth: number,
  sourceHeight: number,
  transform: ItemTransform,
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
  canvasPool?: CanvasPool,
): boolean {
  try {
    const maybeVideoFrame = frame as VideoFrame & {
      visibleRect?: { x: number; y: number; width: number; height: number }
    }
    const visibleRect = maybeVideoFrame.visibleRect
    return drawContainedMediaSource(
      ctx,
      frame,
      sourceWidth,
      sourceHeight,
      transform,
      canvas,
      crop,
      visibleRect,
      canvasPool,
    )
  } catch {
    return false
  }
}

async function tryDrawWorkerPredecodedBitmap(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  canvasSettings: CanvasSettings,
  rctx: ItemRenderContext,
  timelineFrame: number,
  sourceTime: number,
  toleranceSeconds: number,
  allowInactiveProxyFallback = false,
): Promise<boolean> {
  const previewRootFrame = rctx.previewRootTimelineFrame ?? timelineFrame
  const workerSource = rctx.getResolvedVideoSource?.(item, sourceTime, toleranceSeconds) ?? item.src
  if (!canUseWorkerPredecodedFrame(rctx, workerSource)) {
    return false
  }

  const drawBitmap = (bitmap: ImageBitmap): boolean => {
    return drawContainedMediaSource(
      ctx,
      bitmap,
      bitmap.width,
      bitmap.height,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
  }

  const workerBitmapOptions = {
    rctx,
    workerSource,
    sourceTime,
    toleranceSeconds,
    drawBitmap,
    timelineFrame,
    itemId: item.id,
  }
  if (tryDrawCachedWorkerBitmap(workerBitmapOptions)) return true

  if (
    tryDrawActivePreviewFallback({
      rctx,
      previewRootFrame,
      workerSource,
      sourceTime,
      toleranceSeconds,
      drawBitmap,
      timelineFrame,
      itemId: item.id,
      allowOutsideActivePreview: allowInactiveProxyFallback,
    })
  )
    return true

  return tryDrawInflightWorkerBitmap({ ...workerBitmapOptions, previewRootFrame })
}

/**
 * Render video item using mediabunny (fast) or HTML5 video element (fallback).
 */
export async function renderVideoItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number = 0,
  renderSpan?: RenderTimelineSpan,
): Promise<boolean> {
  const {
    fps,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    canvasSettings,
    scrubbingCache,
  } = rctx
  const isPreviewMode = rctx.renderMode === 'preview'
  const allowVideoElementFallback = !isPreviewMode
  const hasFallbackVideoElement = videoElements.has(item.id)
  let extractor = videoExtractors.get(item.id)
  let mediabunnyFailedThisFrame = false
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item)

  // Calculate source time
  const localFrame = frame - effectiveRenderSpan.from
  const localTime = localFrame / fps
  const sourceStart = getRenderTimelineSourceStart(item, effectiveRenderSpan)
  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1

  // Normal: play from sourceStart forwards
  // sourceStart is in source-native FPS frames, so divide by sourceFps (not project fps)
  // Snap to nearest source frame boundary to avoid floating-point drift
  // that can cause Math.floor(sourceTime * sourceFps) to land on the wrong frame.
  const sourceFramesNeeded = (item.durationInFrames * speed * sourceFps) / fps
  const reverseSourceEnd = (item.sourceEnd ?? sourceStart + sourceFramesNeeded) - sourceFrameOffset
  const adjustedSourceStart = sourceStart + sourceFrameOffset
  // A-A transition ramps add extra source frames per timeline frame so left/
  // right participants render distinct source content (otherwise their handle
  // expansions resolve to identical frames and the transition is invisible).
  // Ramps are scoped to the transition window and skip reversed clips.
  const rampOffsetSourceFrames =
    effectiveRenderSpan.sourceTimeRamp && !item.isReversed
      ? getSourceFrameRampOffset(effectiveRenderSpan.sourceTimeRamp, frame)
      : 0
  const unclampedSourceTime = item.isReversed
    ? (reverseSourceEnd - localFrame * speed * (sourceFps / fps) - 1) / sourceFps
    : adjustedSourceStart / sourceFps + localTime * speed + rampOffsetSourceFrames / sourceFps
  const rawSourceTime = clampVideoSourceTime(unclampedSourceTime, sourceFps, item.sourceDuration)
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps)
  const sourceTime =
    Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
      ? (snappedSourceFrame + 1e-4) / sourceFps
      : rawSourceTime
  const tier2ToleranceSeconds = getTier2VideoFrameToleranceSeconds(sourceFps)
  const nonBlockingToleranceSeconds = rctx.nonBlockingVideoFrameToleranceSeconds
  const previewRootFrame = rctx.previewRootTimelineFrame ?? frame
  const holdPreviewFrontBuffer = () => {
    if (isPreviewMode) rctx.markActivePreviewFramePending?.()
  }
  if (rctx.allowPredecodedVideoFrames) {
    const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      frame,
      sourceTime,
      tier2ToleranceSeconds,
    )
    if (drewWorkerBitmap) return true
    if (!extractor && rctx.ensureVideoItemReady) {
      await rctx.ensureVideoItemReady(item.id, item)
      extractor = videoExtractors.get(item.id)
    }
  }
  if (rctx.isActivePreviewFrameSuperseded?.(previewRootFrame)) {
    // A repeated ruler exit can supersede a committed-frame render and then
    // request that same frame again before this render unwinds. Frame-number
    // checks alone can no longer identify this cleared canvas as stale, so
    // explicitly abort its parent render.
    holdPreviewFrontBuffer()
    return false
  }
  if (isPreviewMode && rctx.isActivePreviewFrameCurrent?.(previewRootFrame)) {
    // Held scrubs already have a dedicated exact/fallback bitmap scheduler.
    // Consult it before waiting for a DOM video seek; otherwise the native
    // element can occupy the render pump long enough that the sub-100ms proxy
    // frame is ready but never becomes visible.
    const drewActiveBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      frame,
      sourceTime,
      tier2ToleranceSeconds,
    )
    if (drewActiveBitmap) return true
  }
  if (isPreviewMode && nonBlockingToleranceSeconds !== undefined) {
    // Reverse playback has a decoded-frame runway prepared off-thread. Prefer
    // its nearest display-cadence frame before consulting an asynchronously
    // seeking DOM video. Mixing the two sources makes nested compounds visibly
    // jump when a late browser seek lands between monotonic worker frames.
    const drewNearbyWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      frame,
      sourceTime,
      nonBlockingToleranceSeconds,
      true,
    )
    if (drewNearbyWorkerBitmap) {
      rctx.markActivePreviewFallbackUsed?.()
      return true
    }

    if (scrubbingCache && extractor) {
      const dims = extractor.getDimensions()
      const cachedEntry = scrubbingCache.getVideoFrameEntry(
        item.id,
        sourceTime,
        nonBlockingToleranceSeconds,
      )
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        rctx.markActivePreviewFallbackUsed?.()
        return true
      }
    }
  }
  const domVideoElementProvider = rctx.domVideoElementProvider
  // During transitions, frame can lie outside item's natural span (the
  // participant's renderSpan is extended to cover the transition zone), and
  // the policy function below is already transition-aware: it returns a wider
  // drift threshold and inspects `data-transition-hold`. Check against
  // effectiveRenderSpan (not the natural item span) and let the policy
  // function decide whether the DOM video is fresh enough, mirroring the GPU
  // transition path in gpu.ts which also passes isRenderingTransition through.
  // A-A transition ramps render source frames offset from the DOM video
  // element's natural playback time. Drawing from the live element would
  // ignore the offset and show identical pixels on both transition sides,
  // defeating the ramp. Force the decode path when a ramp is active here.
  const hasActiveRamp =
    !!effectiveRenderSpan.sourceTimeRamp &&
    isFrameInsideSourceTimeRamp(effectiveRenderSpan.sourceTimeRamp, frame)
  const canUseDomVideoElement =
    isPreviewMode &&
    domVideoElementProvider &&
    sourceFrameOffset === 0 &&
    !hasActiveRamp &&
    isFrameInsideItemTimelineSpan(effectiveRenderSpan, frame)
  const domVideo = canUseDomVideoElement ? domVideoElementProvider(item.id) : null
  const domVideoDecisionOptions = {
    domVideo,
    sourceTime,
    speed,
    isRenderingTransition: !!rctx.isRenderingTransition,
    maxDriftSeconds: rctx.isActivePreviewFrameCurrent?.(previewRootFrame)
      ? 0.5 / sourceFps
      : undefined,
  }
  let domVideoDecision = resolvePreviewDomVideoDrawDecision(domVideoDecisionOptions)
  if (domVideoDecision.hasReadyDomVideo && !domVideoDecision.shouldDraw) {
    if (nonBlockingToleranceSeconds === undefined) {
      domVideoDecision = await waitForPreviewDomVideoDrawDecision(domVideoDecisionOptions)
    } else {
      // Reverse shuttle must not serialize the render pump behind a browser
      // seek. Mark a stale DOM frame unavailable so worker/proxy delivery can
      // continue immediately while the coalesced seek settles.
      domVideoDecision = {
        ...domVideoDecision,
        hasReadyDomVideo: false,
      }
    }
  }
  const hasDomVideo = domVideoDecision.hasReadyDomVideo

  // DEV diagnostics: record which transition participants the renderer actually
  // composites per frame. Tree-shaken from prod; no-op unless a trace is running.
  if (import.meta.env.DEV && rctx.isRenderingTransition && isPreviewTraceEnabled()) {
    recordRenderTrace({
      f: frame,
      id: item.id.slice(0, 8),
      rev: item.isReversed === true,
      src: Math.round(sourceTime * 100) / 100,
      hasDom: !!domVideo,
      useMb: useMediabunny.has(item.id),
    })
  }

  // === TRY DOM VIDEO ELEMENT (zero-copy playback path) ===
  // During playback, the Player's <video> elements are already playing
  // at the correct frame. Drawing from them avoids mediabunny decode entirely.
  //
  // For variable-speed clips (speed != 1), mediabunny provides frame-accurate
  // decode. Skip DOM video when mediabunny is warmed. When mediabunny ISN'T
  // warmed, use DOM video as a one-shot fallback to avoid a 300-500ms keyframe
  // seek stall — mediabunny init runs async in the background so subsequent
  // frames switch to frame-accurate decode.
  // Always try DOM video for variable-speed clips during playback. Mediabunny's
  // keyframe seek (400ms+) is worse than DOM video's timing drift. Only skip DOM
  // video for 1x speed clips when mediabunny is available (frame-accurate, fast).
  if (domVideo && domVideoDecision.shouldDraw) {
    recordPreviewVideoSource({ frame, itemId: item.id, path: 'dom-video', sourceTime })
    // Variable-speed clips naturally drift from their DOM video element
    // because the browser plays at 1x while sourceTime advances at speed.
    // Use a wider threshold proportional to speed to avoid falling back
    // to mediabunny decode (which causes 50-500ms freezes on first decode).
    // For variable-speed clips, use a very wide threshold to avoid EVER
    // falling through to mediabunny (400ms+ keyframe seek). DOM video drift
    // is visually acceptable; mediabunny stalls are not.
    //
    // During transitions (entry ramp-up and exit handoff), the DOM video
    // element may be settling — play() was just called, Chrome's decoder
    // is ramping up.  Accept very high drift (1s) to prefer a stale
    // zero-copy frame (~1ms) over a mediabunny decode (~170ms stall).
    // A 1-2 frame-old frame is invisible; a 170ms freeze is not.
    drawContainedMediaSource(
      ctx,
      domVideo,
      domVideo.videoWidth,
      domVideo.videoHeight,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
    // For variable-speed clips using DOM fallback during playback,
    // DON'T kick off mediabunny init — keep using DOM video for the
    // entire playback session. Mediabunny init + keyframe seek takes
    // 400-500ms on the main thread, causing visible frame drops.
    // DOM video has slight timing drift at speed != 1, but no freezes.
    return true
  }

  const mediabunnyInitAction = resolvePreviewMediabunnyInitAction({
    renderMode: rctx.renderMode,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    hasEnsureVideoItemReady: !!rctx.ensureVideoItemReady,
    speed,
  })
  let mediabunnyReadyPromise: Promise<boolean> | null = null
  if (mediabunnyInitAction !== 'none' && rctx.ensureVideoItemReady) {
    // For variable-speed clips during playback, don't block on mediabunny init.
    // The init triggers a keyframe seek that blocks the main thread for 400ms+.
    // Instead, skip this frame (DOM video already drew it or it's invisible).
    mediabunnyReadyPromise = rctx.ensureVideoItemReady(item.id)
    if (mediabunnyInitAction === 'warm-background-and-skip') {
      void mediabunnyReadyPromise
      holdPreviewFrontBuffer()
      return false
    }
    // A cold main-thread MediaBunny init can take hundreds of milliseconds.
    // Continue through worker bitmap and cached-frame fallbacks while it warms.
  }

  // Preview fast-scrub runs in strict decode mode (no HTML video fallbacks).
  // During startup/resolution races, mediabunny may not be ready for this frame yet.
  // In that window, skip drawing this item for the frame instead of logging a
  // misleading "Video element not found" warning.
  if (
    shouldUsePreviewStrictWaitingFallback({
      renderMode: rctx.renderMode,
      hasMediabunny: useMediabunny.has(item.id),
      hasFallbackVideoElement,
    })
  ) {
    if (scrubbingCache && extractor) {
      const dims = extractor.getDimensions()
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return true
      }
    }

    if (
      shouldTryPreviewWorkerBitmap({
        renderMode: rctx.renderMode,
        hasReadyDomVideo: hasDomVideo,
        allowPredecodedVideoFrames: rctx.allowPredecodedVideoFrames,
      })
    ) {
      const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
        ctx,
        item,
        transform,
        canvasSettings,
        rctx,
        frame,
        sourceTime,
        tier2ToleranceSeconds,
      )
      if (drewWorkerBitmap) {
        if (rctx.ensureVideoItemReady && !mediabunnyReadyPromise) {
          void rctx.ensureVideoItemReady(item.id)
        }
        return true
      }
    }

    if (
      mediabunnyInitAction === 'warm-background-and-continue' &&
      mediabunnyReadyPromise &&
      extractor
    ) {
      let ready = false
      try {
        ready = await mediabunnyReadyPromise
      } catch {
        // Best effort in preview; a failed initializer leaves this frame undrawn.
      }
      if (ready && useMediabunny.has(item.id) && !mediabunnyDisabledItems.has(item.id)) {
        // Cached and worker-backed paths stay non-blocking. Only retry after every
        // fallback missed, where returning now would otherwise expose a blank frame.
        return renderVideoItem(
          ctx,
          item,
          transform,
          frame,
          rctx,
          sourceFrameOffset,
          effectiveRenderSpan,
        )
      }
    }

    const pendingWorkerSource =
      rctx.getResolvedVideoSource?.(item, sourceTime, tier2ToleranceSeconds) ?? item.src
    if (domVideo) {
      // A nested/compound DOM video can briefly fall below drawable readiness
      // while rapid Play/Pause seeks it. This happens on both pause and resume;
      // the element is still the authoritative source, so committing the
      // freshly-cleared composition canvas would replace the front buffer with black.
      holdPreviewFrontBuffer()
      return false
    }
    const isPendingOrSupersededSource =
      pendingWorkerSource &&
      (rctx.isActivePreviewSourceTarget?.(pendingWorkerSource, sourceTime, tier2ToleranceSeconds) ||
        rctx.isActivePreviewTargetSuperseded?.(
          pendingWorkerSource,
          sourceTime,
          tier2ToleranceSeconds,
        ))
    if (rctx.isActivePreviewFrameCurrent?.(previewRootFrame) || isPendingOrSupersededSource) {
      // Direction changes can cancel the old source request before the new
      // one is registered. The root frame is still active, so returning it as
      // complete would commit a partially rendered (usually black) canvas.
      holdPreviewFrontBuffer()
    }
    return false
  }

  // === TRY PRE-DECODED BITMAP (from background Web Worker) ===
  // Prefer a worker-decoded exact frame before a cold main-thread extractor draw.
  // This keeps large-jump and transition-entry stalls off the main thread while
  // preserving the same exact-frame preview path once the extractor is warm.
  if (
    shouldTryPreviewWorkerBitmap({
      renderMode: rctx.renderMode,
      hasReadyDomVideo: hasDomVideo,
      allowPredecodedVideoFrames: rctx.allowPredecodedVideoFrames,
    })
  ) {
    const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
      ctx,
      item,
      transform,
      canvasSettings,
      rctx,
      frame,
      sourceTime,
      tier2ToleranceSeconds,
    )
    if (drewWorkerBitmap) {
      if (!useMediabunny.has(item.id) && rctx.ensureVideoItemReady) {
        void rctx.ensureVideoItemReady(item.id)
      }
      return true
    }
  }

  if (isPreviewMode && nonBlockingToleranceSeconds !== undefined) {
    // The display keeps its last valid pixels while the cancellable worker
    // lane decodes the newest reverse target. Never fall through to a
    // main-thread MediaBunny seek for this transient transport mode.
    holdPreviewFrontBuffer()
    return false
  }

  const resolvedWorkerSource =
    rctx.getResolvedVideoSource?.(item, sourceTime, tier2ToleranceSeconds) ?? item.src
  const rootFrameSuperseded = rctx.isActivePreviewFrameSuperseded?.(previewRootFrame) === true
  const sourceTargetSuperseded = Boolean(
    resolvedWorkerSource &&
    rctx.isActivePreviewTargetSuperseded?.(resolvedWorkerSource, sourceTime, tier2ToleranceSeconds),
  )
  if (rootFrameSuperseded || sourceTargetSuperseded) {
    // The pointer has already moved and the active worker cancelled this exact
    // frame. Do not replace that cancellation with a blocking main-thread
    // MediaBunny seek; the render pump will immediately pick up the latest
    // target and stale-frame presentation guards keep this canvas hidden.
    holdPreviewFrontBuffer()
    return false
  }

  if (rctx.isActivePreviewFrameCurrent?.(previewRootFrame)) {
    // Keep the last valid preview visible while the isolated worker finishes
    // this exact target. The worker-ready subscription wakes the render pump;
    // avoiding MediaBunny here keeps pointer input and cancellation responsive.
    rctx.markActivePreviewFramePending?.()
    return false
  }

  // === TRY MEDIABUNNY FIRST (fast, precise frame access) ===
  // With the overlap model, source times are always valid during transitions
  // (both clips have real content in the overlap region), so no past-duration
  // workaround is needed.
  if (useMediabunny.has(item.id) && !mediabunnyDisabledItems.has(item.id) && extractor) {
    const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01))
    const dims = extractor.getDimensions()
    const drawLayout = calculateContainedMediaDrawLayout(
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
    )

    if (isPreviewMode && scrubbingCache) {
      const cachedEntry = scrubbingCache.getVideoFrameEntry(
        item.id,
        clampedTime,
        tier2ToleranceSeconds,
      )
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return true
      }
    }

    if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
      log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`)
    }

    if (
      rctx.renderMode === 'export' &&
      item.isReversed &&
      sourceFrameOffset === 0 &&
      rctx.reverseVideoFrameCache
    ) {
      const cachedReverseFrame = await rctx.reverseVideoFrameCache.getFrame({
        item,
        extractor,
        frame,
        renderSpan: effectiveRenderSpan,
        fps,
        sourceFps,
        speed,
      })
      if (
        cachedReverseFrame &&
        drawTier2VideoFrame(
          ctx,
          cachedReverseFrame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        mediabunnyFailureCountByItem.set(item.id, 0)
        return true
      }
    }

    let success = false
    let capturedFrame: ImageBitmap | VideoFrame | null = null
    let capturedSourceTime: number | null = null
    const drawExtractorFrame = async (
      targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    ) =>
      isPreviewMode && scrubbingCache && rctx.captureDecodedVideoFrames !== false
        ? await extractor.drawFrameWithCapture(
            targetCtx,
            clampedTime,
            drawLayout.mediaRect.x,
            drawLayout.mediaRect.y,
            drawLayout.mediaRect.width,
            drawLayout.mediaRect.height,
          )
        : {
            success: await extractor.drawFrame(
              targetCtx,
              clampedTime,
              drawLayout.mediaRect.x,
              drawLayout.mediaRect.y,
              drawLayout.mediaRect.width,
              drawLayout.mediaRect.height,
            ),
            capturedFrame: null,
            capturedSourceTime: null,
          }

    if (hasCropFeather(drawLayout.featherPixels)) {
      const { canvas: scratchCanvas, ctx: scratchCtx } = rctx.canvasPool.acquire()
      try {
        scratchCtx.save()
        clipToViewport(scratchCtx, drawLayout.viewportRect)
        try {
          const result = await drawExtractorFrame(scratchCtx)
          success = result.success
          capturedFrame = result.capturedFrame
          capturedSourceTime = result.capturedSourceTime
        } finally {
          scratchCtx.restore()
        }

        if (success) {
          applyCropFeatherMask(scratchCtx, drawLayout.viewportRect, drawLayout.featherPixels)
          ctx.drawImage(scratchCanvas, 0, 0)
        }
      } finally {
        rctx.canvasPool.release(scratchCanvas)
      }
    } else {
      ctx.save()
      clipToViewport(ctx, drawLayout.viewportRect)
      try {
        const result = await drawExtractorFrame(ctx)
        success = result.success
        capturedFrame = result.capturedFrame
        capturedSourceTime = result.capturedSourceTime
      } finally {
        ctx.restore()
      }
    }

    if (success) {
      recordPreviewVideoSource({
        frame,
        itemId: item.id,
        path: 'mediabunny',
        sourceTime: clampedTime,
        canUseDom: canUseDomVideoElement,
        domAvailable: Boolean(domVideo),
        domReady: domVideoDecision.hasReadyDomVideo,
        domDrift: domVideoDecision.drift,
      })
      mediabunnyFailureCountByItem.set(item.id, 0)
      if (scrubbingCache && capturedFrame) {
        scrubbingCache.putVideoFrame(item.id, capturedFrame, capturedSourceTime ?? clampedTime)
      }
      return true
    }
    mediabunnyFailedThisFrame = true

    // Distinguish transient misses from decode failures.
    const failureKind = extractor.getLastFailureKind()
    if (isPreviewMode && scrubbingCache && failureKind === 'no-sample') {
      const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
      if (
        cachedEntry &&
        drawTier2VideoFrame(
          ctx,
          cachedEntry.frame,
          dims.width,
          dims.height,
          transform,
          canvasSettings,
          item.crop,
          rctx.canvasPool,
        )
      ) {
        return true
      }
    }
    if (failureKind === 'no-sample') {
      log.debug('Mediabunny had no sample for timestamp, using per-frame fallback', {
        itemId: item.id,
        frame,
        sourceTime: clampedTime,
      })
    } else {
      const failureCount = (mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1
      mediabunnyFailureCountByItem.set(item.id, failureCount)

      if (failureCount >= 3) {
        mediabunnyDisabledItems.add(item.id)
        const logDisable = isPreviewMode ? log.debug : log.warn
        logDisable(
          'Disabling mediabunny for item after repeated failures; using fallback for remainder of render',
          {
            itemId: item.id,
            frame,
            sourceTime: clampedTime,
            failureCount,
          },
        )
      } else {
        const logDrawFailure = isPreviewMode ? log.debug : log.warn
        logDrawFailure('Mediabunny frame draw failed, using fallback', {
          itemId: item.id,
          frame,
          sourceTime: clampedTime,
          failureCount,
        })
      }
    }
  }

  // === FALLBACK TO HTML5 VIDEO ELEMENT (slower, seeks required) ===
  const allowPreviewFallback = shouldAllowPreviewVideoElementFallback({
    renderMode: rctx.renderMode,
    hasFallbackVideoElement,
    hasMediabunny: useMediabunny.has(item.id),
    isMediabunnyDisabled: mediabunnyDisabledItems.has(item.id),
    mediabunnyFailedThisFrame,
  })
  if (!allowVideoElementFallback && !allowPreviewFallback) {
    holdPreviewFrontBuffer()
    return false
  }

  const video = videoElements.get(item.id)
  if (!video) {
    log.warn('Video element not found', { itemId: item.id, frame })
    holdPreviewFrontBuffer()
    return false
  }

  const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01))

  const SEEK_TOLERANCE = isPreviewMode ? 0.05 : 0.034
  const SEEK_TIMEOUT = isPreviewMode ? 24 : 150
  const READY_TIMEOUT = isPreviewMode ? 40 : 300

  const needsSeek = Math.abs(video.currentTime - clampedTime) > SEEK_TOLERANCE
  if (needsSeek) {
    video.currentTime = clampedTime

    if (!isPreviewMode) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }, SEEK_TIMEOUT)
      })
    }
  }

  // Wait for video to have enough data to draw
  if (video.readyState < 2) {
    if (isPreviewMode) {
      holdPreviewFrontBuffer()
      return false
    }

    await new Promise<void>((resolve) => {
      const checkReady = () => {
        if (video.readyState >= 2) {
          video.removeEventListener('canplay', checkReady)
          video.removeEventListener('loadeddata', checkReady)
          resolve()
        }
      }
      video.addEventListener('canplay', checkReady)
      video.addEventListener('loadeddata', checkReady)
      checkReady()
      setTimeout(() => {
        video.removeEventListener('canplay', checkReady)
        video.removeEventListener('loadeddata', checkReady)
        resolve()
      }, READY_TIMEOUT)
    })
  }

  if (video.readyState < 2) {
    if (import.meta.env.DEV && frame < 5)
      log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`)
    return false
  }

  if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
    log.debug(
      `VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`,
    )
  }

  drawContainedMediaSource(
    ctx,
    video,
    video.videoWidth,
    video.videoHeight,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
  return true
}

export function resolveVideoParticipantSourceTime(
  item: VideoItem,
  renderSpan: RenderTimelineSpan,
  frame: number,
  rctx: ItemRenderContext,
): number {
  const localFrame = frame - renderSpan.from
  const localTime = localFrame / rctx.fps
  const sourceStart = getRenderTimelineSourceStart(item, renderSpan)
  const sourceFps = item.sourceFps ?? rctx.fps
  const speed = item.speed ?? 1
  const sourceFramesNeeded = (item.durationInFrames * speed * sourceFps) / rctx.fps
  const reverseSourceEnd = item.sourceEnd ?? sourceStart + sourceFramesNeeded
  const rampOffsetSourceFrames =
    renderSpan.sourceTimeRamp && !item.isReversed
      ? getSourceFrameRampOffset(renderSpan.sourceTimeRamp, frame)
      : 0
  const unclampedSourceTime = item.isReversed
    ? (reverseSourceEnd - localFrame * speed * (sourceFps / rctx.fps) - 1) / sourceFps
    : sourceStart / sourceFps + localTime * speed + rampOffsetSourceFrames / sourceFps
  const rawSourceTime = clampVideoSourceTime(unclampedSourceTime, sourceFps, item.sourceDuration)
  const snappedSourceFrame = Math.round(rawSourceTime * sourceFps)
  return Math.abs(rawSourceTime * sourceFps - snappedSourceFrame) < 1e-6
    ? (snappedSourceFrame + 1e-4) / sourceFps
    : rawSourceTime
}
