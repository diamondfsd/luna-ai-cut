/**
 * Client-side render hook
 *
 * Provides a React hook for video rendering using mediabunny.
 * Uses blob URLs directly, runs entirely in the browser with WebCodecs.
 *
 * Settings resolution (codec fallback) and worker orchestration live in
 * `../utils/render-pipeline` so this hook and the render queue runner stay in
 * lockstep.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ExportSettings, ExtendedExportSettings } from '@freecut/types/export'
import type { RenderProgress, ClientRenderResult, ClientCodec } from '../utils/client-renderer'
import {
  mapToClientSettings,
  getSupportedCodecs,
  formatBytes,
  estimateFileSize,
  getVideoBitrateForQuality,
} from '../utils/client-renderer'
import {
  isExtendedSettings,
  mapRequestedClientSettings,
  resolveClientSettings,
  runRender,
} from '../utils/render-pipeline'
import { trySmartCopyExport } from '../utils/smart-copy'
import { convertTimelineToComposition } from '../utils/timeline-to-composition'
import { buildTranscriptSubtitleCues } from '../utils/embedded-subtitle-export'
import { serializeSrt } from '@freecut/shared/utils/subtitles'
import { releaseTemporaryExportOutput } from '../utils/export-output-target'
import { useTimelineStore } from '@freecut/features/export/deps/timeline'
import { useProjectStore } from '@freecut/features/export/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import { resolveMediaUrls } from '@freecut/features/export/deps/media-library'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { createLogger, createOperationId } from '@freecut/shared/logging/logger'
import { useEmbeddedHost, type EmbeddedExportSaveResult } from '@freecut/shared/host/embedded-host'
import { buildDirectExportFiles } from '../utils/direct-export-files'

const log = createLogger('Export')

type ClientRenderStatus =
  | 'idle'
  | 'preparing'
  | 'rendering'
  | 'encoding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface UseClientRenderReturn {
  // State
  isExporting: boolean
  progress: number
  progressMessage?: string
  renderedFrames?: number
  totalFrames?: number
  status: ClientRenderStatus
  error: string | null
  result: ClientRenderResult | null
  savedFiles: EmbeddedExportSaveResult[]
  supportsDirectSave: boolean

  // Actions
  startExport: (settings: ExportSettings | ExtendedExportSettings) => Promise<void>
  cancelExport: () => void
  downloadVideo: () => void
  revealSavedFile: () => Promise<void>
  resetState: () => void

  // Utilities
  getSupportedCodecs: (options?: {
    resolution?: { width: number; height: number }
    quality?: ExportSettings['quality']
    bitrate?: number
  }) => Promise<ClientCodec[]>
  estimateFileSize: (settings: ExportSettings, durationSeconds: number) => string
}

export function useClientRender(): UseClientRenderReturn {
  const { exportFiles } = useEmbeddedHost()
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState<string>()
  const [renderedFrames, setRenderedFrames] = useState<number>()
  const [totalFrames, setTotalFrames] = useState<number>()
  const [status, setStatus] = useState<ClientRenderStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ClientRenderResult | null>(null)
  const [savedFiles, setSavedFiles] = useState<EmbeddedExportSaveResult[]>([])
  const resultRef = useRef<ClientRenderResult | null>(null)

  const saveToDesktop = useCallback(async (
    renderResult: ClientRenderResult,
    settings: ExportSettings | ExtendedExportSettings,
    projectName: string | undefined,
    signal: AbortSignal,
  ): Promise<EmbeddedExportSaveResult[]> => {
    if (!exportFiles) return []
    const directory = isExtendedSettings(settings) ? settings.outputDirectory : undefined
    if (!directory) throw new Error('请先选择导出目录')
    setStatus('finalizing')
    setProgressMessage('正在保存文件…')
    return exportFiles.saveFiles(
      directory,
      buildDirectExportFiles(renderResult, projectName),
      signal,
    )
  }, [exportFiles])

  // AbortController for cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Handle progress updates from the render engine
   */
  const handleProgress = useCallback((progressData: RenderProgress) => {
    setProgress(progressData.progress)
    setProgressMessage(progressData.message)
    setRenderedFrames(progressData.currentFrame)
    setTotalFrames(progressData.totalFrames)

    // Map phase to status
    switch (progressData.phase) {
      case 'preparing':
        setStatus('preparing')
        break
      case 'rendering':
        setStatus('rendering')
        break
      case 'encoding':
        setStatus('encoding')
        break
      case 'finalizing':
        setStatus('finalizing')
        break
    }
  }, [])

  /**
   * Start client-side export
   */
  const startExport = useCallback(
    async (settings: ExportSettings | ExtendedExportSettings) => {
      const opId = createOperationId()
      const event = log.startEvent('render', opId)

      try {
        const previousResult = resultRef.current
        resultRef.current = null
        void releaseTemporaryExportOutput(previousResult)
        setIsExporting(true)
        setProgress(0)
        setProgressMessage(undefined)
        setError(null)
        setResult(null)
        setSavedFiles([])
        setStatus('preparing')

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController()

        // Read current state from stores
        const state = useTimelineStore.getState()
        const { tracks, items, transitions, fps, inPoint, outPoint, keyframes } = state

        // Get project metadata (background color and native resolution)
        const currentProject = useProjectStore.getState().currentProject
        const busAudioEq = usePlaybackStore.getState().busAudioEq
        const masterBusDb = usePlaybackStore.getState().masterBusDb
        const backgroundColor = currentProject?.metadata?.backgroundColor
        // Use PROJECT resolution for composition (transform calculations match preview)
        const projectWidth = currentProject?.metadata?.width ?? DEFAULT_PROJECT_WIDTH
        const projectHeight = currentProject?.metadata?.height ?? DEFAULT_PROJECT_HEIGHT

        const requested = mapRequestedClientSettings(settings, fps)
        // When renderWholeProject is true, ignore in/out points.
        const { exportMode, renderWholeProject } = requested
        const effectiveInPoint = renderWholeProject ? null : inPoint
        const effectiveOutPoint = renderWholeProject ? null : outPoint
        const signal = abortControllerRef.current.signal

        const smartCopy = await trySmartCopyExport(
          {
            settings: requested.clientSettings,
            tracks,
            items,
            transitions,
            keyframes,
            fps,
            width: projectWidth,
            height: projectHeight,
            inPoint: effectiveInPoint,
            outPoint: effectiveOutPoint,
            busAudioEq,
            masterBusDb,
          },
          signal,
          handleProgress,
        )

        if (smartCopy.result) {
          resultRef.current = smartCopy.result
          const desktopFiles = await saveToDesktop(
            smartCopy.result,
            settings,
            currentProject?.name,
            signal,
          )
          setResult(smartCopy.result)
          setSavedFiles(desktopFiles)
          setStatus('completed')
          setProgress(100)
          event.set('renderPath', 'smart-copy')
          event.success({
            fileSize: smartCopy.result.fileSize,
            fileSizeFormatted: formatBytes(smartCopy.result.fileSize),
            duration: smartCopy.result.duration,
          })
          return
        }

        // Resolve settings + codec fallback only when an encoder is required.
        const { clientSettings, codecFallback } = await resolveClientSettings(settings, fps)
        if (codecFallback) event.set('codecFallback', codecFallback)

        const extended = isExtendedSettings(settings)
        event.merge({
          mode: exportMode,
          fps,
          tracks: tracks.length,
          items: items.length,
          inPoint: effectiveInPoint,
          outPoint: effectiveOutPoint,
          renderWholeProject,
          keyframes: keyframes?.length ?? 0,
          projectResolution: `${projectWidth}x${projectHeight}`,
          videoContainer: extended ? settings.videoContainer : undefined,
          audioContainer: extended ? settings.audioContainer : undefined,
          subtitleMode: clientSettings.subtitleMode,
          projectId: currentProject?.id,
          codec: clientSettings.codec,
          container: clientSettings.container,
          resolution: `${clientSettings.resolution.width}x${clientSettings.resolution.height}`,
        })

        // Convert timeline to Composition format (handles I/O point trimming)
        // Use PROJECT resolution so transforms match preview (will scale to export res later)
        const composition = convertTimelineToComposition(
          tracks,
          items,
          transitions,
          fps,
          projectWidth,
          projectHeight,
          effectiveInPoint,
          effectiveOutPoint,
          keyframes,
          backgroundColor,
          busAudioEq,
          masterBusDb,
        )

        const totalCompositionItems = composition.tracks.reduce(
          (sum, t) => sum + (t.items?.length ?? 0),
          0,
        )
        const compositionDuration = composition.durationInFrames ?? 0

        event.merge({
          compositionDuration: compositionDuration,
          compositionDurationSec: compositionDuration / fps,
          compositionTracks: composition.tracks.length,
          compositionItems: totalCompositionItems,
        })

        // Resolve media URLs (convert mediaIds to blob URLs)
        // Export always uses full-res source, never proxies
        const resolvedTracks = await resolveMediaUrls(composition.tracks, { useProxy: false })
        composition.tracks = resolvedTracks

        // Count resolved items for diagnostics
        let totalResolvedItems = 0
        let itemsWithSrc = 0
        let itemsMissingSrc = 0
        for (const track of resolvedTracks) {
          for (const item of track.items ?? []) {
            totalResolvedItems++
            if ('src' in item && item.src) {
              itemsWithSrc++
            } else if (
              item.type === 'video' ||
              item.type === 'audio' ||
              item.type === 'image' ||
              item.type === 'lottie'
            ) {
              itemsMissingSrc++
              log.warn('Media item missing src after resolve', {
                opId,
                itemId: item.id,
                type: item.type,
                mediaId: item.mediaId,
              })
            }
          }
        }

        event.merge({
          resolvedItems: totalResolvedItems,
          itemsWithSrc,
          itemsMissingSrc,
        })

        // Run the render (worker, with automatic main-thread fallback).
        const {
          result: renderResult,
          renderPath,
          fallbackReason,
        } = await runRender({
          clientSettings,
          exportMode,
          composition,
          signal,
          onProgress: handleProgress,
        })
        if (fallbackReason) event.set('workerFallbackReason', fallbackReason)

        // Sidecar mode: the video is muxed clean; build the .srt from the same
        // (export-trimmed) composition on the main thread and attach it so the
        // dialog can offer it as a second download.
        let finalResult = renderResult
        if (clientSettings.subtitleMode === 'sidecar') {
          const cues = buildTranscriptSubtitleCues(composition)
          if (cues.length > 0) {
            finalResult = {
              ...renderResult,
              subtitleSidecar: { filename: 'subtitles.srt', content: serializeSrt(cues) },
            }
            event.set('subtitleSidecarCues', cues.length)
          }
        }

        resultRef.current = finalResult
        const desktopFiles = await saveToDesktop(
          finalResult,
          settings,
          currentProject?.name,
          signal,
        )
        setResult(finalResult)
        setSavedFiles(desktopFiles)
        setStatus('completed')
        setProgress(100)

        event.set('renderPath', renderPath)
        event.success({
          fileSize: renderResult.fileSize,
          fileSizeFormatted: formatBytes(renderResult.fileSize),
          duration: renderResult.duration,
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          event.set('outcome', 'cancelled')
          event.set('duration_ms', Date.now())
          log.event('render', { opId, outcome: 'cancelled' })
          setStatus('cancelled')
        } else {
          event.failure(err)
          const message = err instanceof Error ? err.message : 'Failed to export'
          setError(message)
          setStatus('failed')
        }
      } finally {
        setIsExporting(false)
        abortControllerRef.current = null
      }
    },
    [handleProgress, saveToDesktop],
  )

  /**
   * Cancel the current export. Aborting the controller signals `runRender`,
   * which posts the cancel to its worker and terminates it.
   */
  const cancelExport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setStatus('cancelled')
      setIsExporting(false)
    }
  }, [])

  /**
   * Download the rendered video/audio
   */
  const downloadVideo = useCallback(() => {
    if (!result) return

    const url = URL.createObjectURL(result.blob)
    const a = document.createElement('a')
    a.href = url

    // Determine file extension from MIME type
    let extension = 'mp4'
    const mime = result.mimeType.toLowerCase()
    if (mime.includes('webm')) extension = 'webm'
    else if (mime.includes('matroska')) extension = 'mkv'
    else if (mime.includes('quicktime') || mime.includes('mov')) extension = 'mov'
    else if (mime.includes('audio/mpeg') || mime.includes('mp3')) extension = 'mp3'
    else if (mime.includes('audio/wav') || mime.includes('wave')) extension = 'wav'
    else if (mime.includes('audio/aac') || mime.includes('adts')) extension = 'aac'

    const baseName = `export-${Date.now()}`
    a.download = `${baseName}.${extension}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Revoke during idle — download has already started by then
    requestIdleCallback(() => URL.revokeObjectURL(url))

    // Sidecar mode: download the .srt alongside, sharing the video's base name.
    const sidecar = result.subtitleSidecar
    if (sidecar) {
      const sidecarExt = sidecar.filename.split('.').pop() ?? 'srt'
      const sidecarBlob = new Blob([sidecar.content], { type: 'text/plain;charset=utf-8' })
      const sidecarUrl = URL.createObjectURL(sidecarBlob)
      const sidecarLink = document.createElement('a')
      sidecarLink.href = sidecarUrl
      sidecarLink.download = `${baseName}.${sidecarExt}`
      document.body.appendChild(sidecarLink)
      sidecarLink.click()
      document.body.removeChild(sidecarLink)
      requestIdleCallback(() => URL.revokeObjectURL(sidecarUrl))
    }
  }, [result])

  const revealSavedFile = useCallback(async () => {
    const first = savedFiles[0]
    if (first && exportFiles) await exportFiles.revealFile(first.filePath)
  }, [exportFiles, savedFiles])

  /**
   * Reset state
   */
  const resetState = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsExporting(false)
    setProgress(0)
    setProgressMessage(undefined)
    setRenderedFrames(undefined)
    setTotalFrames(undefined)
    setStatus('idle')
    setError(null)
    setSavedFiles([])
    const previousResult = resultRef.current
    resultRef.current = null
    void releaseTemporaryExportOutput(previousResult)
    setResult(null)
  }, [])

  useEffect(
    () => () => {
      void releaseTemporaryExportOutput(resultRef.current)
      resultRef.current = null
    },
    [],
  )

  /**
   * Get supported codecs for the current resolution
   */
  const getSupportedCodecsForResolution = useCallback(
    async (options?: {
      resolution?: { width: number; height: number }
      quality?: ExportSettings['quality']
      bitrate?: number
    }) => {
      const currentProject = useProjectStore.getState().currentProject
      const width =
        options?.resolution?.width ?? currentProject?.metadata?.width ?? DEFAULT_PROJECT_WIDTH
      const height =
        options?.resolution?.height ?? currentProject?.metadata?.height ?? DEFAULT_PROJECT_HEIGHT
      const bitrate =
        options?.bitrate ??
        (options?.quality ? getVideoBitrateForQuality(options.quality) : undefined)

      const codecs = await getSupportedCodecs({ width, height, bitrate })
      return codecs
    },
    [],
  )

  /**
   * Estimate file size for given settings
   */
  const estimateFileSizeForSettings = useCallback(
    (settings: ExportSettings, durationSeconds: number) => {
      const fps = useTimelineStore.getState().fps
      const clientSettings = mapToClientSettings(settings, fps)
      const bytes = estimateFileSize(clientSettings, durationSeconds)
      return formatBytes(bytes)
    },
    [],
  )

  return {
    isExporting,
    progress,
    progressMessage,
    renderedFrames,
    totalFrames,
    status,
    error,
    result,
    savedFiles,
    supportsDirectSave: Boolean(exportFiles),
    startExport,
    cancelExport,
    downloadVideo,
    revealSavedFile,
    resetState,
    getSupportedCodecs: getSupportedCodecsForResolution,
    estimateFileSize: estimateFileSizeForSettings,
  }
}
