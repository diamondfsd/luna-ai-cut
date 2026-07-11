import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { DownloadProgress, LunaFile, PreviewResult } from '../shared/types'
import { useMediaLibraryTransferActions } from './useMediaLibraryTransferActions'
import { useApp } from '../context/AppContext'
import { useOptionalDownloadProgress } from '../context/DownloadProgressContext'
import { useExportProgress } from '../context/ExportProgressContext'
import { useDeviceConnection } from '../context/DeviceConnectionContext'
import { logger } from '../lib/rendererLogger'

type MediaFilter = 'all' | 'image' | 'video'
type DownloadStatusFilter = 'all' | 'downloaded' | 'not-downloaded'
export type CardSize = 'large' | 'medium' | 'small'
export type SortOrder = 'desc' | 'asc'
export type ViewMode = 'download' | 'export'
export type PageType = 'camera' | 'local'

function groupFiles(files: LunaFile[]): Array<[string, LunaFile[]]> {
  const groups = new Map<string, LunaFile[]>()
  for (const file of files) {
    groups.set(file.groupDay, [...(groups.get(file.groupDay) ?? []), file])
  }
  return [...groups.entries()]
}

/**
 * 媒体库页面状态控制器。
 *
 * 根据 pageType 决定:
 * - 'camera' — 从相机设备加载文件，支持下载、存储筛选
 * - 'local'  — 加载本地下载/导出文件，支持删除、导出、发送到工作台
 *
 * 所有外部依赖（settings、downloadProgress、activeDevice）从 Context 获取，
 * 不再需要父组件通过 props 传递。
 */
export function useMediaLibraryController(pageType: PageType) {
  const { settings } = useApp()
  const { exportProgress } = useExportProgress()
  const downloadProgressContext = useOptionalDownloadProgress()
  const [fallbackDownloadProgress, setFallbackDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map())
  const downloadProgress = downloadProgressContext?.downloadProgress ?? fallbackDownloadProgress
  const setDownloadProgress = downloadProgressContext?.setDownloadProgress ?? setFallbackDownloadProgress
  const { activeDevice } = useDeviceConnection()
  const isCamera = pageType === 'camera'
  const isLocal = pageType === 'local'

  // ── 文件数据层 ──
  const [files, setFiles] = useState<LunaFile[]>([])
  const [downloadedFiles, setDownloadedFiles] = useState<LunaFile[]>([])
  const [exportedFiles, setExportedFiles] = useState<LunaFile[]>([])

  // ── 选择状态 ──
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── 筛选/排序 ──
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [downloadStatusFilter, setDownloadStatusFilter] = useState<DownloadStatusFilter>('all')
  const [cardSize, setCardSize] = useState<CardSize>('large')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [storageFilter, setStorageFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('download')

  // ── 加载状态（含防重 ref） ──
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingDownloads, setLoadingDownloads] = useState(false)
  const loadingCameraRef = useRef(false)
  const loadingDownloadsRef = useRef(false)

  // ── 下载队列 ──
  const [downloadQueue, setDownloadQueue] = useState<LunaFile[]>([])
  const [activeDownloadFileNames, setActiveDownloadFileNames] = useState<Set<string>>(new Set())
  const [cacheFailedIds, setCacheFailedIds] = useState<Set<string>>(new Set())
  const requestedThumbnailIdsRef = useRef(new Set<string>())
  const requestedFrameRateIdsRef = useRef(new Set<string>())
  const requestFrameRateRef = useRef<(file: LunaFile, localPath: string | null | undefined) => void>(() => {})

  // ── 预览状态 ──
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewFile, setPreviewFile] = useState<LunaFile | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFiles, setPreviewFiles] = useState<LunaFile[]>([])
  const previewRequestIdRef = useRef(0)

  // ── 删除 ──
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingLocalFiles, setDeletingLocalFiles] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── 滚动分组 ──
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  // ═══════════════════════════════════════════
  // 派生值
  // ═══════════════════════════════════════════

  const activeDeviceId = activeDevice?.id ?? settings?.activeDeviceId ?? ''

  const storageOptions = useMemo(() => {
    if (isCamera) {
      return [
        { value: 'all', label: '全部' },
        ...(activeDevice?.storages?.map((s) => ({ value: s.id, label: s.label })) ?? []),
      ]
    }
    return [{ value: 'all', label: '全部' }]
  }, [activeDevice?.storages, isCamera])

  // 当前数据源：各 pageType 管理自己的文件列表，消除 isDownloadsPage 分支
  const currentFiles = useMemo(
    () => (isLocal ? (viewMode === 'export' ? exportedFiles : downloadedFiles) : files),
    [isLocal, viewMode, files, downloadedFiles, exportedFiles],
  )

  const filteredFiles = useMemo(() => {
    return currentFiles
      .filter((file) => {
        const matchesType = mediaFilter === 'all' || file.kind === mediaFilter
        const progress = downloadProgress.get(file.name)
        const isDownloaded = Boolean(
          file.downloadFilePath || file.localPath || progress?.status === 'done' || progress?.status === 'exists',
        )
        if (isCamera) {
          const matchesStorage = storageFilter === 'all' || file.storageId === storageFilter
          const matchesDownloadStatus = downloadStatusFilter === 'all'
            || (downloadStatusFilter === 'downloaded' ? isDownloaded : !isDownloaded)
          return matchesType && matchesStorage && matchesDownloadStatus
        }
        return matchesType
      })
      .sort((a, b) => {
        const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
        const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
        const order = sortOrder === 'desc' ? bTime - aTime : aTime - bTime
        return order || a.name.localeCompare(b.name)
      })
  }, [currentFiles, mediaFilter, sortOrder, downloadProgress, downloadStatusFilter, storageFilter, isCamera])

  const selectedFiles = currentFiles.filter((file) => selected.has(file.id))
  const totalSelectedBytes = selectedFiles.reduce((sum, file) => sum + (file.bytes ?? 0), 0)
  const groups = groupFiles(filteredFiles)
  const firstGroup = groups[0]?.[0] ?? null
  const isCurrentLoading = isLocal ? loadingDownloads : loadingFiles
  const progressForPreview = previewFile ? downloadProgress.get(previewFile.name) : undefined

  // downloading 从 downloadProgress 派生，不再需要父组件传入
  const downloading = useMemo(
    () => [...downloadProgress.values()].some((p) => p.status === 'queued' || p.status === 'downloading'),
    [downloadProgress],
  )

  // ═══════════════════════════════════════════
  // 副作用
  // ═══════════════════════════════════════════

  // 从设置中初始化存储筛选
  useEffect(() => {
    if (isCamera) {
      setStorageFilter(settings?.deviceStorage?.[activeDeviceId] ?? 'all')
    }
  }, [activeDeviceId, settings?.deviceStorage, isCamera])

  // 自动加载文件
  useEffect(() => {
    if (isLocal) {
      void loadDownloadedLibrary()
    } else if (settings) {
      void loadCameraLibrary()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice?.id, pageType, settings?.downloadDir, storageFilter])

  // 本地导出视图自动加载
  useEffect(() => {
    if (isLocal && viewMode === 'export') {
      void loadExportLibrary()
    }
  }, [isLocal, viewMode, settings?.exportDir])

  // 本地页：下载完成后自动刷新
  const prevDoneCountRef = useRef(0)
  useEffect(() => {
    if (!isLocal) return
    const doneCount = [...downloadProgress.values()].filter(
      (p) => p.status === 'done' || p.status === 'exists',
    ).length
    if (prevDoneCountRef.current > 0 && doneCount > prevDoneCountRef.current) {
      void loadDownloadedLibrary()
    }
    prevDoneCountRef.current = doneCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadProgress, isLocal])

  // 滚动分组 IntersectionObserver
  useEffect(() => {
    setActiveGroup(firstGroup)
    if (!firstGroup) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const group = visible?.target.getAttribute('data-group')
        if (group) setActiveGroup(group)
      },
      { rootMargin: '-112px 0px -72% 0px', threshold: [0, 0.01, 0.1] },
    )

    document
      .querySelectorAll<HTMLElement>('.media-section[data-group]')
      .forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [downloadStatusFilter, firstGroup, groups.length, sortOrder, mediaFilter])

  // 监听缓存缩略图完成
  useEffect(() => {
    return window.luna.onThumbnailReady(({ fileId, fileName, downloadName, cacheFilePath, thumbnailUrl }) => {
      const matches = (file: LunaFile): boolean =>
        file.id === fileId || file.name === fileName || file.downloadName === downloadName
      setCacheFailedIds((current) => {
        if (!current.has(fileId)) return current
        const next = new Set(current)
        next.delete(fileId)
        return next
      })
      setFiles((current) =>
        current.map((f) => (matches(f) ? { ...f, cacheFilePath, thumbnailUrl } : f)),
      )
      setDownloadedFiles((current) =>
        current.map((f) => (matches(f) ? { ...f, cacheFilePath, thumbnailUrl } : f)),
      )
      const mockFile: Partial<LunaFile> = { id: fileId, cacheFilePath, kind: 'video' }
      requestFrameRateRef.current(mockFile as LunaFile, null)
    })
  }, [])

  // 监听视频帧率就绪
  useEffect(() => {
    return window.luna.onVideoFrameRateReady(({ fileId, fileName, duration }) => {
      if (duration == null) return
      const applyDuration = (current: LunaFile[]): LunaFile[] =>
        current.map((file) => (
          file.id === fileId || file.name === fileName ? { ...file, duration } : file
        ))
      setFiles(applyDuration)
      setDownloadedFiles(applyDuration)
    })
  }, [])

  // ═══════════════════════════════════════════
  // 缩略图与帧率
  // ═══════════════════════════════════════════

  function requestThumbnail(file: LunaFile): void {
    if (file.thumbnailUrl || cacheFailedIds.has(file.id) || requestedThumbnailIdsRef.current.has(file.id)) return
    requestedThumbnailIdsRef.current.add(file.id)
    void window.luna
      .cacheFile({ sourceUrl: file.sourceUrl, previewUrl: file.previewUrl })
      .then((ok) => {
        if (!ok) {
          logger.warn('[缩略图] cacheFile 返回 false，标记 cacheFailed', { fileId: file.id, fileName: file.name, kind: file.kind })
          setCacheFailedIds((current) => new Set(current).add(file.id))
        }
      })
      .catch((err) => {
        logger.error('[缩略图] cacheFile IPC 异常', {
          fileId: file.id,
          fileName: file.name,
          kind: file.kind,
          error: err instanceof Error ? err.message : String(err),
        })
        setCacheFailedIds((current) => new Set(current).add(file.id))
      })
  }

  function requestFrameRate(file: LunaFile, localPath: string | null | undefined): void {
    const videoPath = localPath ?? file.cacheFilePath
    if (file.kind !== 'video' || !videoPath || file.duration != null || requestedFrameRateIdsRef.current.has(file.id)) return
    requestedFrameRateIdsRef.current.add(file.id)
    void window.luna.requestVideoFrameRate(file, videoPath).catch(() => {
      requestedFrameRateIdsRef.current.delete(file.id)
    })
  }

  requestFrameRateRef.current = requestFrameRate

  function handleThumbnailImageLoad(file: LunaFile, localPath: string | null | undefined): void {
    requestThumbnail(file)
    requestFrameRate(file, localPath)
  }

  function handleThumbnailImageError(file: LunaFile): void {
    requestedThumbnailIdsRef.current.delete(file.id)
    setFiles((current) =>
      current.map((f) => (f.id === file.id ? { ...f, thumbnailUrl: null } : f)),
    )
    setDownloadedFiles((current) =>
      current.map((f) => (f.id === file.id ? { ...f, thumbnailUrl: null } : f)),
    )
    setTimeout(() => requestThumbnail({ ...file, thumbnailUrl: null }), 300)
  }

  // ═══════════════════════════════════════════
  // 文件加载
  // ═══════════════════════════════════════════

  async function loadCameraLibrary(): Promise<void> {
    if (!settings || loadingCameraRef.current) return
    loadingCameraRef.current = true
    setLoadingFiles(true)
    const t0 = performance.now()
    try {
      const host = settings.cameraHost
      logger.info('[媒体库] 开始从设备加载文件', { host, storageFilter })
      const tCheck = performance.now()
      await window.luna.checkConnection(host)
      logger.info('[媒体库] checkConnection 完成', { host, elapsedMs: Math.round(performance.now() - tCheck) })
      const tList = performance.now()
      const lunaFiles = await window.luna.listFiles(host, storageFilter)
      logger.info('[媒体库] listFiles 完成', { host, fileCount: lunaFiles.length, elapsedMs: Math.round(performance.now() - tList) })
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
      logger.info('[媒体库] 设备文件加载完成', { host, fileCount: lunaFiles.length, elapsedSec: elapsed, storageFilter })
      setFiles(lunaFiles)
      setSelected(new Set())
      setCacheFailedIds(new Set())
      requestedThumbnailIdsRef.current.clear()
      requestedFrameRateIdsRef.current.clear()
    } catch (error) {
      logger.error('[媒体库] 设备文件加载失败', { error: error instanceof Error ? error.message : String(error), storageFilter })
    } finally {
      loadingCameraRef.current = false
      setLoadingFiles(false)
    }
  }

  async function loadDownloadedLibrary(): Promise<void> {
    if (!settings?.downloadDir || loadingDownloadsRef.current) return
    loadingDownloadsRef.current = true
    setLoadingDownloads(true)
    try {
      const localFiles = await window.luna.listDownloadedFiles(settings.downloadDir)
      setDownloadedFiles(localFiles)
      setSelected(new Set())
      setCacheFailedIds(new Set())
      requestedThumbnailIdsRef.current.clear()
      requestedFrameRateIdsRef.current.clear()
    } catch (error) {
      console.error(error)
    } finally {
      loadingDownloadsRef.current = false
      setLoadingDownloads(false)
    }
  }

  async function loadExportLibrary(): Promise<void> {
    if (!settings?.exportDir) return
    try {
      const exportFiles = await window.luna.listExportFiles(settings.exportDir)
      setExportedFiles(exportFiles)
    } catch (error) {
      console.error(error)
    }
  }

  async function handleStorageFilterChange(value: string): Promise<void> {
    setStorageFilter(value)
    setSelected(new Set())
    setCacheFailedIds(new Set())
    await window.luna.saveSettings({
      deviceStorage: {
        ...(settings?.deviceStorage ?? {}),
        [activeDeviceId]: value,
      },
    })
  }

  // ═══════════════════════════════════════════
  // 选择逻辑
  // ═══════════════════════════════════════════

  function toggleFile(file: LunaFile): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(file.id)) next.delete(file.id)
      else next.add(file.id)
      return next
    })
  }

  function toggleGroup(items: LunaFile[]): void {
    setSelected((current) => {
      const next = new Set(current)
      const allSelected = items.every((file) => next.has(file.id))
      for (const file of items) {
        if (allSelected) next.delete(file.id)
        else next.add(file.id)
      }
      return next
    })
  }

  // ═══════════════════════════════════════════
  // 预览
  // ═══════════════════════════════════════════

  async function openPreview(file: LunaFile, options?: { playLive?: boolean; keepPreviewFiles?: boolean; previewFiles?: LunaFile[] }): Promise<void> {
    const requestId = previewRequestIdRef.current + 1
    previewRequestIdRef.current = requestId
    if (!options?.keepPreviewFiles) {
      setPreviewFiles(options?.previewFiles ?? filteredFiles)
    }
    setPreviewFile(file)
    setPreview(null)
    if (!file.canPreview) return
    setPreviewLoading(true)
    try {
      const nextPreview = await window.luna.previewFile(file, currentFiles)
      if (previewRequestIdRef.current !== requestId) return
      setPreview(nextPreview)
    } catch (error) {
      if (previewRequestIdRef.current !== requestId) return
      setPreview({
        fileName: file.name,
        kind: file.kind,
        source: null,
        cachedPath: null,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (previewRequestIdRef.current === requestId) {
        setPreviewLoading(false)
      }
    }
  }

  function handlePreviewClick(file: LunaFile): void {
    void openPreview(file, { previewFiles: filteredFiles })
  }

  // ═══════════════════════════════════════════
  // 传输操作（下载/删除/导出）
  // ═══════════════════════════════════════════

  const {
    deleteSelectedLocalFiles,
    downloadOne,
    markFileDownloaded,
    restoreDownloadedRecords,
    startDownload,
  } = useMediaLibraryTransferActions({
    files,
    selectedFiles,
    settings,
    setActiveDownloadFileNames,
    setDeleteError,
    setDeletingLocalFiles,
    setDownloadProgress,
    setDownloadQueue,
    setDownloadedFiles,
    setExportedFiles,
    setFiles,
    setPreviewFile,
    setPreviewFiles,
    setSelected,
    setShowDeleteDialog,
    viewMode,
    loadDownloadedLibrary,
    loadExportLibrary,
  })

  // ═══════════════════════════════════════════
  // 在文件管理器中显示
  // ═══════════════════════════════════════════

  function revealDownloadedFile(progress: DownloadProgress | undefined): void {
    if (progress?.destinationPath) {
      void window.luna.revealFile(progress.destinationPath)
    }
  }

  function revealFileByPath(path: string): void {
    void window.luna.revealFile(path)
  }

  return {
    // 页面类型
    pageType,
    isDownloadsPage: isLocal,

    // 选择
    selected,
    selectedFiles,
    setSelected,
    toggleFile,
    toggleGroup,
    totalSelectedBytes,

    // 筛选/排序
    mediaFilter,
    setMediaFilter,
    cardSize,
    setCardSize,
    sortOrder,
    setSortOrder,
    filteredFiles,
    groups,
    firstGroup,
    activeGroup,

    // 相机页面专用
    downloadStatusFilter,
    setDownloadStatusFilter,
    storageFilter,
    storageOptions,
    handleStorageFilterChange,
    downloadQueue,
    setDownloadQueue,
    activeDownloadFileNames,
    setActiveDownloadFileNames,
    cacheFailedIds,
    loadCameraLibrary,

    // 本地页面专用
    viewMode,
    setViewMode,
    showDeleteDialog,
    setShowDeleteDialog,
    deleteError,
    setDeleteError,
    deletingLocalFiles,
    deleteSelectedLocalFiles,
    loadDownloadedLibrary,
    loadExportLibrary,

    // 预览
    previewFile,
    preview,
    previewLoading,
    previewFiles,
    setPreviewFile,
    setPreviewFiles,
    handlePreviewClick,
    openPreview,
    progressForPreview,

    // 缩略图
    handleThumbnailImageLoad,
    handleThumbnailImageError,

    // 下载/传输
    downloading,
    startDownload,
    downloadOne,
    markFileDownloaded,
    restoreDownloadedRecords,
    revealDownloadedFile,
    revealFileByPath,

    // 加载状态
    isCurrentLoading,

    // 应用级
    downloadProgress,
    exportProgress,
  }
}

// ── Media Library Context ──
// 通过 Context 共享控制器状态，页面组件无需透传 props 给子组件

export type MediaLibraryController = ReturnType<typeof useMediaLibraryController>

const MediaLibraryCtx = createContext<MediaLibraryController | null>(null)

export function useMediaLib(): MediaLibraryController {
  const ctx = useContext(MediaLibraryCtx)
  if (!ctx) throw new Error('useMediaLib must be used within MediaLibraryContext.Provider')
  return ctx
}

export { MediaLibraryCtx }
