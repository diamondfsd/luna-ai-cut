import { useCallback, useEffect, useRef } from 'react'
import type { CompositionInput } from '../shared/types/render'

const ENGINE_ID = 'main'

interface LunaRenderCoreApi {
  createPreviewEngine(engineId: string, config: { dragMaxSide?: number; playMaxSide?: number; finalMaxSide?: number }): Promise<void>
  updatePreviewState(engineId: string, input: { requestId: number; mode: string; time: number; composition: CompositionInput }): void
  getLatestPreviewFrame(engineId: string): Promise<{ frameId: number; requestId: number; data: Uint8Array | ArrayBuffer; width: number; height: number } | null>
  destroyPreviewEngine(engineId: string): Promise<void>
}

function getLRC(): LunaRenderCoreApi | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderCoreApi }).lunaRenderCore
}

export interface PreviewFrameData {
  frameId: number
  requestId: number
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface UsePreviewEngineOptions {
  dragMaxSide?: number
  playMaxSide?: number
  finalMaxSide?: number
}

export function usePreviewEngine(options: UsePreviewEngineOptions = {}) {
  const engineCreatedRef = useRef(false)
  const requestIdRef = useRef(0)
  const lastFrameIdRef = useRef(-1)
  const latestFrameRef = useRef<PreviewFrameData | null>(null)
  const destroyedRef = useRef(false)

  const createEngine = useCallback(async () => {
    const lrc = getLRC()
    if (!lrc) throw new Error('渲染引擎未加载')
    if (engineCreatedRef.current) return
    engineCreatedRef.current = true
    destroyedRef.current = false
    await lrc.createPreviewEngine(ENGINE_ID, {
      dragMaxSide: options.dragMaxSide ?? 720,
      playMaxSide: options.playMaxSide ?? 1280,
      finalMaxSide: options.finalMaxSide ?? 1920,
    })
  }, [options.dragMaxSide, options.playMaxSide, options.finalMaxSide])

  const destroyEngine = useCallback(async () => {
    const lrc = getLRC()
    if (!lrc) return
    destroyedRef.current = true
    engineCreatedRef.current = false
    await lrc.destroyPreviewEngine(ENGINE_ID)
  }, [])

  const updateState = useCallback((mode: 'idle' | 'playing' | 'dragging' | 'final-seek', time: number, composition: CompositionInput) => {
    const lrc = getLRC()
    if (!lrc || !engineCreatedRef.current || destroyedRef.current) return
    const requestId = ++requestIdRef.current
    lrc.updatePreviewState(ENGINE_ID, {
      requestId,
      mode,
      time,
      composition,
    })
    return requestId
  }, [])

  const pullLatestFrame = useCallback(async (): Promise<PreviewFrameData | null> => {
    const lrc = getLRC()
    if (!lrc || !engineCreatedRef.current || destroyedRef.current) return null
    try {
      const result = await lrc.getLatestPreviewFrame(ENGINE_ID)
      if (!result) return null
      const { frameId, requestId, data, width, height } = result
      if (frameId === lastFrameIdRef.current) return null
      lastFrameIdRef.current = frameId

      const clamped = data instanceof Uint8Array
        ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8ClampedArray(data)

      const frame: PreviewFrameData = { frameId, requestId, data: clamped, width, height }
      latestFrameRef.current = frame
      return frame
    } catch {
      return null
    }
  }, [])

  const getCurrentFrame = useCallback((): PreviewFrameData | null => {
    return latestFrameRef.current
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      destroyedRef.current = true
      // 注意：不要在 unmount 时自动 destroy，因为 React StrictMode 会 double-invoke
    }
  }, [])

  return {
    createEngine,
    destroyEngine,
    updateState,
    pullLatestFrame,
    getCurrentFrame,
    requestIdRef,
  }
}

/** 渲染进程侧的引擎管理器：单例 */
let engineInitialized = false
let engineDestroyed = false

export async function initPreviewEngine(): Promise<void> {
  if (engineInitialized) return
  const lrc = getLRC()
  if (!lrc) throw new Error('渲染引擎未加载')
  engineInitialized = true
  engineDestroyed = false
  await lrc.createPreviewEngine(ENGINE_ID, {
    dragMaxSide: 720,
    playMaxSide: 1280,
    finalMaxSide: 1920,
  })
}

export function updatePreviewState(
  mode: 'idle' | 'playing' | 'dragging' | 'final-seek',
  time: number,
  composition: CompositionInput,
): void {
  const lrc = getLRC()
  if (!lrc || !engineInitialized || engineDestroyed) return
  lrc.updatePreviewState(ENGINE_ID, {
    requestId: Date.now(),
    mode,
    time,
    composition,
  })
}

export async function getLatestPreviewFrame(): Promise<PreviewFrameData | null> {
  const lrc = getLRC()
  if (!lrc || !engineInitialized || engineDestroyed) return null
  try {
    const result = await lrc.getLatestPreviewFrame(ENGINE_ID)
    if (!result) return null
    const { frameId, requestId, data, width, height } = result

    const clamped = data instanceof Uint8Array
      ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8ClampedArray(data)

    return { frameId, requestId, data: clamped, width, height }
  } catch {
    return null
  }
}

export async function destroyPreviewEngine(): Promise<void> {
  const lrc = getLRC()
  if (!lrc) return
  engineDestroyed = true
  engineInitialized = false
  await lrc.destroyPreviewEngine(ENGINE_ID)
}
