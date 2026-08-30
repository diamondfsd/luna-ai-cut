import { useEffect, useRef, useState, forwardRef, memo, useImperativeHandle } from 'react'
import type { PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { useCanvasViewportInteraction } from './useCanvasViewportInteraction'
import {
  calcRenderSize,
  computeLayerDecodeMaxSide,
  describeVideoLoadFailure,
  multipleLayerVideoPreviewPropsEqual,
  normalizedPreviewMaxSide,
  perfLog,
  releasePreviewTextures,
  renderMultipleLayerVideoFrame,
  videoLayerKey,
  type LunaRenderCore,
  type MultipleLayerVideoPreviewLrcRenderProps,
  type VideoStateEntry,
} from './multipleLayerVideoFrameRenderer'

export type { MultipleLayerVideoPreviewLrcRenderProps } from './multipleLayerVideoFrameRenderer'
function getLRC(): LunaRenderCore | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderCore }).lunaRenderCore
}

/** 多视频层前端解码、Rust GPU 合成预览组件。 */
export const MultipleLayerVideoPreviewLrcRender = memo(
  forwardRef<unknown, MultipleLayerVideoPreviewLrcRenderProps>(
    function MultipleLayerVideoPreviewLrcRender(
      { layers, active = true, className, canvasWidth, canvasHeight, maxSide, playing = false, compositionTime, decodeQuality = 1.5, onError, onReady, onRender, onVideoElement, imageScale, onImageScaleChange, maxImageScale = 5, interactiveImageLayerIndexes, viewportKey },
      ref,
    ) {
      const outputCanvasRef = useRef<HTMLCanvasElement>(null)
      const lrcRef = useRef<LunaRenderCore | null>(null)
      const destroyRef = useRef(false)
      const activeRef = useRef(active)
      const readyRef = useRef(false)
      const scheduledRenderRef = useRef(0)
      const renderingRef = useRef(false)
      const renderQueuedRef = useRef(false)
      const [ready, setReady] = useState(false)
      const [fatalError, setFatalError] = useState<string | null>(null)
      const imageInteraction = useCanvasViewportInteraction({
        layers,
        canvasRef: outputCanvasRef,
        interactiveImageLayerIndexes,
        viewportKey,
        maxImageScale,
        imageScale,
        onImageScaleChange,
      })

      const layersRef = useRef(layers)
      const layersRevisionRef = useRef(0)
      if (layersRef.current !== layers) {
        layersRevisionRef.current += 1
        layersRef.current = layers
      }
      activeRef.current = active
      const playingRef = useRef(playing)
      playingRef.current = playing
      const compositionTimeRef = useRef(compositionTime)
      compositionTimeRef.current = compositionTime
      const canvasWidthRef = useRef(canvasWidth)
      canvasWidthRef.current = canvasWidth
      const canvasHeightRef = useRef(canvasHeight)
      canvasHeightRef.current = canvasHeight
      const maxSideRef = useRef(normalizedPreviewMaxSide(maxSide))
      maxSideRef.current = normalizedPreviewMaxSide(maxSide)
      const decodeQualityRef = useRef(decodeQuality)
      decodeQualityRef.current = decodeQuality
      const onVideoElementRef = useRef(onVideoElement)
      onVideoElementRef.current = onVideoElement
      const notifiedVideoRef = useRef<HTMLVideoElement | null>(null)
      const videoStatesRef = useRef<Map<string, VideoStateEntry>>(new Map())
      const imageTextureCacheRef = useRef<Map<string, number>>(new Map())
      const textureVersionRef = useRef(0)

      // 同步主视频元素（取第一个视频层）到父组件
      function syncPrimaryVideo(): void {
        const firstEntry = videoStatesRef.current.values().next().value as VideoStateEntry | undefined
        const primaryVideo = firstEntry?.video ?? null
        if (notifiedVideoRef.current !== primaryVideo) {
          notifiedVideoRef.current = primaryVideo
          onVideoElementRef.current?.(primaryVideo)
        }
      }

      /**
       * 合并同一次屏幕刷新周期内的 loaded/seek/video-frame 请求。
       * 多视频层可能几乎同时产出画面，不应为每个回调分别走一次 RGBA IPC。
       */
      function scheduleRender(): void {
        if (destroyRef.current || !activeRef.current || scheduledRenderRef.current !== 0) return
        scheduledRenderRef.current = requestAnimationFrame(() => {
          scheduledRenderRef.current = 0
          void renderFrame()
        })
      }

      function cancelVideoFrameCallback(entry: VideoStateEntry): void {
        if (entry.frameCallbackId === null) return
        entry.video.cancelVideoFrameCallback?.(entry.frameCallbackId)
        entry.frameCallbackId = null
      }

      /**
       * 跟随 Chromium 真正呈现的视频帧驱动合成。
       * 暂停时回调自然停止；seek 呈现新帧时会触发一次，不需要固定 30fps 空转。
       */
      function scheduleVideoFrameCallback(entry: VideoStateEntry): void {
        if (
          destroyRef.current
          || !activeRef.current
          || entry.frameCallbackId !== null
          || typeof entry.video.requestVideoFrameCallback !== 'function'
        ) return
        entry.frameCallbackId = entry.video.requestVideoFrameCallback(() => {
          entry.frameCallbackId = null
          if (destroyRef.current || videoStatesRef.current.get(entry.key) !== entry) return
          scheduleRender()
          scheduleVideoFrameCallback(entry)
        })
      }

      // ── 初始化 LRC ──
      useEffect(() => {
        const perfWindow = window as Window & { __perfStart?: number }
        const videoStates = videoStatesRef.current
        const imageTextures = imageTextureCacheRef.current
        const textureVersion = textureVersionRef
        perfWindow.__perfStart = perfWindow.__perfStart ?? performance.now()
        const t0 = performance.now()
        perfLog(`MultipleLayerVideoPreviewLrcRender mount layers=${layers.length}`)
        const lrc = getLRC()
        if (!lrc) {
          const msg = '渲染引擎未加载'
          setFatalError(msg)
          onError?.(msg)
          return
        }
        destroyRef.current = false
        lrcRef.current = lrc
        lrc.init()
          .then(() => {
            const t1 = performance.now()
            perfLog(`LRC init done in ${(t1 - t0).toFixed(0)}ms`)
            if (!destroyRef.current) {
              setReady(true)
              readyRef.current = true
              onReady?.()
              void lrc.getNativePreviewCapabilities?.().then((capabilities) => {
                perfLog(
                  `native preview decoder=${capabilities.decoder}`
                  + ` hardware=${capabilities.systemHardwareDecode}`
                  + ` externalTexture=${capabilities.externalGpuTexture}`
                  + ` directPresent=${capabilities.directGpuPresentation}`,
                )
              }).catch(() => {})
            }
          })
          .catch((error: Error) => {
            if (destroyRef.current) return
            const msg = `渲染引擎初始化失败: ${error.message}`
            setFatalError(msg)
            onError?.(msg)
          })
        return () => {
          destroyRef.current = true
          cancelAnimationFrame(scheduledRenderRef.current)
          scheduledRenderRef.current = 0
          // 通知父组件视频元素已释放
          notifiedVideoRef.current = null
          onVideoElementRef.current?.(null)
          // 暂停所有视频并清空 src，避免关闭后仍播放声音
          for (const entry of videoStates.values()) {
            cancelVideoFrameCallback(entry)
            entry.video.pause()
            entry.video.src = ''
            if (entry.textureId > 0) {
              lrc.releaseTexture(entry.textureId).catch(() => {})
            }
          }
          videoStates.clear()
          // 释放所有图片纹理
          for (const texId of imageTextures.values()) {
            lrc.releaseTexture(texId).catch(() => {})
          }
          imageTextures.clear()
          textureVersion.current++
        }
      // 生命周期初始化只执行一次，内部通过 refs 读取并清理实时资源。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useImperativeHandle(ref, () => ({
        scheduleRender: () => { if (readyRef.current) scheduleRender() },
        setLayers: (newLayers: PreviewLayer[]) => { layersRef.current = newLayers },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }), [])

      // ── 管理视频元素 ──
      useEffect(() => {
        if (!readyRef.current || !active) {
          if (!active) {
            for (const entry of videoStatesRef.current.values()) {
              cancelVideoFrameCallback(entry)
              entry.video.pause()
            }
          }
          // LRC 尚未就绪，跳过视频创建；依赖有 ready，等 ready 变为 true 后自动重跑
          return
        }
        const t0 = performance.now()
        perfLog(`video management effect start, ${layers.filter(l => l.isVideo).length} video layers`)
        const lrc = lrcRef.current
        if (!lrc) return

        // 收集当前需要的视频层
        const requiredKeys = new Set<string>()
        const videoLayerInfos: Array<{ layer: PreviewLayer; index: number; key: string }> = []

        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i]
          if (layer.isVideo) {
            const key = videoLayerKey(layer)
            requiredKeys.add(key)
            videoLayerInfos.push({ layer, index: i, key })
          }
        }
        // 单视频层预览保留原声；两个及以上视频层没有明确的混音规则，全部静音。
        // 图片、水印等非视频层不影响音频判断。
        const previewAudioEnabled = requiredKeys.size === 1

        // 移除不再需要的视频状态
        for (const [existingKey, entry] of videoStatesRef.current) {
          if (!requiredKeys.has(existingKey)) {
            cancelVideoFrameCallback(entry)
            if (entry.textureId > 0) {
              const tid = entry.textureId
              entry.textureId = 0 // 先清除，避免并发 renderFrame 读取到已释放的 ID
              lrc.releaseTexture(tid).catch(() => {})
              textureVersionRef.current++
            }
            entry.video.pause()
            entry.video.src = ''
            videoStatesRef.current.delete(existingKey)
          }
        }
        syncPrimaryVideo()

        // 创建 / 复用视频元素
        for (const { layer, key } of videoLayerInfos) {
          const existing = videoStatesRef.current.get(key)
          const src = filePathToPreviewUrl(layer.filePath) ?? layer.filePath

          if (existing) {
            existing.video.muted = !previewAudioEnabled
            if (existing.ready) {
              const layerMaxSide = computeLayerDecodeMaxSide(
                layer,
                canvasWidth,
                canvasHeight,
                decodeQuality,
                normalizedPreviewMaxSide(maxSide),
              )
              const [renderW, renderH] = calcRenderSize(
                existing.video.videoWidth || 1280,
                existing.video.videoHeight || 720,
                layerMaxSide,
              )
              if (renderW !== existing.renderW || renderH !== existing.renderH) {
                if (existing.textureId > 0) {
                  const textureId = existing.textureId
                  existing.textureId = 0
                  lrc.releaseTexture(textureId).catch(() => {})
                  textureVersionRef.current++
                }
                existing.offscreen = new OffscreenCanvas(renderW, renderH)
                existing.renderW = renderW
                existing.renderH = renderH
              }
            }
            const vt = layer.videoTime ?? 0
            if (Math.abs(existing.prevVideoTime - vt) > 0.01) {
              existing.video.currentTime = vt
              existing.prevVideoTime = vt
            }
            continue
          }

          // 创建新 video 元素
          const video = document.createElement('video')
          video.muted = !previewAudioEnabled
          video.loop = false
          video.playsInline = true
          video.preload = 'auto'
          video.crossOrigin = 'anonymous'
          video.src = src

          const entry: VideoStateEntry = {
            key,
            video,
            frameCallbackId: null,
            textureId: 0,
            offscreen: null,
            renderW: 0,
            renderH: 0,
            prevVideoTime: layer.videoTime ?? 0,
            ready: false,
          }

          video.addEventListener('loadeddata', () => {
            if (destroyRef.current) return
            const tLoaded = performance.now()
            perfLog(`video loadeddata [${layer.filePath.slice(-30)}] in ${(tLoaded - t0).toFixed(0)}ms offset`)
            // 根据该层的显示尺寸 + 质量系数计算解码上限
            const layerMaxSide = computeLayerDecodeMaxSide(
              layer,
              canvasWidthRef.current,
              canvasHeightRef.current,
              decodeQualityRef.current,
              maxSideRef.current,
            )
            const srcMax = Math.max(video.videoWidth || 1280, video.videoHeight || 720)
            const effectiveMaxSide = Math.min(srcMax, layerMaxSide)
            const [rw, rh] = calcRenderSize(
              video.videoWidth || 1280,
              video.videoHeight || 720,
              effectiveMaxSide,
            )
            entry.offscreen = new OffscreenCanvas(rw, rh)
            entry.renderW = rw
            entry.renderH = rh
            entry.ready = true
            entry.video.currentTime = layer.videoTime ?? 0
            if (playingRef.current) entry.video.play().catch(() => {})
            scheduleVideoFrameCallback(entry)
            scheduleRender()
          })

          video.addEventListener('seeked', () => {
            if (destroyRef.current) return
            scheduleRender()
          })

          video.addEventListener('timeupdate', () => {
            if (
              destroyRef.current
              || !entry.ready
              || typeof video.requestVideoFrameCallback === 'function'
            ) return
            scheduleRender()
          })

          video.addEventListener('error', () => {
            // 清理时设置 src='' 会触发 MEDIA_ELEMENT_ERROR(4)，属预期行为，静默忽略
            if (video.error?.code === 4) return
            const message = describeVideoLoadFailure(layer.filePath, video.error)
            console.error('[MultipleLayerVideoPreviewLrcRender] video error', {
              file: layer.filePath,
              code: video.error?.code,
              message: video.error?.message,
            })
            onError?.(message)
          })

          video.load()
          videoStatesRef.current.set(key, entry)
        }
        syncPrimaryVideo()
        const tEnd = performance.now()
        perfLog(`video management effect done in ${(tEnd - t0).toFixed(0)}ms, ${videoStatesRef.current.size} videos managed`)
      // 调度函数通过 refs 访问最新状态，避免视频回调因函数重建而重复注册。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active, canvasHeight, canvasWidth, decodeQuality, layers, maxSide, ready])

      // ── 播放/暂停控制 ──
      useEffect(() => {
        if (!readyRef.current) return
        for (const [, entry] of videoStatesRef.current) {
          if (!entry.ready) continue
          if (active) scheduleVideoFrameCallback(entry)
          if (playing && active) {
            entry.video.play().catch(() => {})
          } else {
            entry.video.pause()
          }
        }
        if (active) scheduleRender()
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active, ready, playing])

      async function renderFrame() {
        const lrc = lrcRef.current
        const canvas = outputCanvasRef.current
        const currentLayers = layersRef.current
        if (!lrc || !canvas || destroyRef.current || !activeRef.current) return

        if (renderingRef.current) {
          renderQueuedRef.current = true
          return
        }

        renderingRef.current = true
        renderQueuedRef.current = false
        // 快照当前纹理版本，渲染完成后检查是否有纹理在此期间被释放
        const versionAtStart = textureVersionRef.current
        const layersRevisionAtStart = layersRevisionRef.current

        try {
          const result = await renderMultipleLayerVideoFrame({
            lrc,
            canvas,
            layers: currentLayers,
            videoStates: videoStatesRef.current,
            imageTextures: imageTextureCacheRef.current,
            compositionTime: compositionTimeRef.current,
            canvasWidth: canvasWidthRef.current,
            canvasHeight: canvasHeightRef.current,
            maxSide: maxSideRef.current,
            textureVersion: versionAtStart,
            getTextureVersion: () => textureVersionRef.current,
            renderRevision: layersRevisionAtStart,
            getRenderRevision: () => layersRevisionRef.current,
            isDestroyed: () => destroyRef.current,
          })
          if (result === 'stale') {
            renderQueuedRef.current = true
            return
          }
          if (result === 'rendered' && activeRef.current) onRender?.()
        } catch (error) {
          // 组件已卸载（如 tab 切换）时纹理被清理导致 renderFrame IPC 报错属正常，静默忽略
          if (destroyRef.current) return

          const msg = error instanceof Error ? error.message : String(error)
          console.error('[MultipleLayerVideoPreviewLrcRender] render error:', error)
          const lrcCleanup = lrcRef.current
          if (lrcCleanup) {
            releasePreviewTextures(
              lrcCleanup,
              videoStatesRef.current,
              imageTextureCacheRef.current,
            )
          }
          textureVersionRef.current++
          onError?.(msg)
        } finally {
          renderingRef.current = false
          if (renderQueuedRef.current && !destroyRef.current && activeRef.current) {
            renderQueuedRef.current = false
            void renderFrame()
          }
        }
      }

      // ── layers 变化时触发一次渲染 ──
      // renderFrame 内部通过 layersRef.current 读取最新 layers，不受闭包影响。
      useEffect(() => {
        if (!ready || !active) return
        scheduleRender()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active, layers, ready])

      // ── 错误状态 UI ──
      if (fatalError) {
        return (
          <div
            className={className}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <p
              style={{
                color: 'var(--red, #e53e3e)',
                fontSize: 14,
                textAlign: 'center',
                padding: 16,
              }}
            >
              {fatalError}
            </p>
          </div>
        )
      }

      const canvasClassName = [
        className,
        imageInteraction.interactive && 'lrc-render-interactive',
        imageInteraction.dragging && 'is-dragging',
      ]
        .filter(Boolean)
        .join(' ')

      return (
        <canvas
          ref={outputCanvasRef}
          className={canvasClassName}
          style={imageInteraction.style}
          onPointerDown={imageInteraction.onPointerDown}
          onPointerMove={imageInteraction.onPointerMove}
          onPointerUp={imageInteraction.onPointerEnd}
          onPointerCancel={imageInteraction.onPointerEnd}
          onWheel={imageInteraction.onWheel}
          onDoubleClick={imageInteraction.onDoubleClick}
        />
      )
    },
  ),
  multipleLayerVideoPreviewPropsEqual,
)
