import { useEffect, useMemo, useRef, useState } from 'react'

import type { AppSettings, DeviceDefinition, DownloadProgress, ExportProgress, LunaFile, PreviewResult, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { useMediaLibraryTransferActions } from './useMediaLibraryTransferActions'

type MediaFilter = 'all' | 'image' | 'video'
type DownloadStatusFilter = 'all' | 'downloaded' | 'not-downloaded'
export type CardSize = 'large' | 'medium' | 'small'
export type SortOrder = 'desc' | 'asc'
export type ViewMode = 'download' | 'export'
type StorageFilter = string

export interface MediaLibraryPageProps {
  isDownloadsPage: boolean
  /** 当前页面是否为激活状态（否则隐藏页面应阻止预览弹窗等 Portal 元素渲染） */
  pageActive?: boolean
  settings: AppSettings | null
  downloadProgress: Map<string, DownloadProgress>
  setDownloadProgress: React.Dispatch<React.SetStateAction<Map<string, DownloadProgress>>>
  downloading: boolean
  setDownloading: (d: boolean) => void
  previewFile: LunaFile | null
  setPreviewFile: React.Dispatch<React.SetStateAction<LunaFile | null>>
  preview: PreviewResult | null
  setPreview: (p: PreviewResult | null) => void
  previewLoading: boolean
  setPreviewLoading: (b: boolean) => void
  activeDevice?: DeviceDefinition
  refreshKey?: number
  selectMode?: boolean
  onSelect?: (files: LunaFile[]) => void
}

function groupFiles(files: LunaFile[]): Array<[string, LunaFile[]]> {
  const groups = new Map<string, LunaFile[]>()
  for (const file of files) {
    groups.set(file.groupDay, [...(groups.get(file.groupDay) ?? []), file])
  }
  return [...groups.entries()]
}

export function useMediaLibraryController({
  isDownloadsPage,
  settings,
  downloadProgress,
  setDownloadProgress,
  previewFile,
  setPreviewFile,
  setPreview,
  setPreviewLoading,
  activeDevice,
  refreshKey,
}: MediaLibraryPageProps) {
  const [files, setFiles] = useState<LunaFile[]>([])
  const [downloadedFiles, setDownloadedFiles] = useState<LunaFile[]>([])
  const [previewFiles, setPreviewFiles] = useState<LunaFile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [downloadStatusFilter, setDownloadStatusFilter] = useState<DownloadStatusFilter>('all')
  const [cardSize, setCardSize] = useState<CardSize>('large')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [query] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingDownloads, setLoadingDownloads] = useState(false)
  const [downloadQueue, setDownloadQueue] = useState<LunaFile[]>([])
  const [activeDownloadFileNames, setActiveDownloadFileNames] = useState<Set<string>>(new Set())
  const [cacheFailedIds, setCacheFailedIds] = useState<Set<string>>(new Set())
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [autoPlayLiveFileId, setAutoPlayLiveFileId] = useState<string | null>(null)
  const [storageFilter, setStorageFilter] = useState<StorageFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('download')
  const [exportedFiles, setExportedFiles] = useState<LunaFile[]>([])
  const [exporting, setExporting] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingLocalFiles, setDeletingLocalFiles] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<Map<string, ExportProgress>>(new Map())
  const [exportSnapshots, setExportSnapshots] = useState<Map<string, LunaFile>>(new Map())
  const [exportWatermarkSettings, setExportWatermarkSettings] = useState<WatermarkSettingsType>(() => ({
    enabled: true,
    style: 'luna_ultra_cn',
    watermarkPercent: 20,
    position: 'bottom-center',
  }))

  // 监听导出进度
  useEffect(() => {
    return window.luna.onExportProgress((progress) => {
      setExportProgress((current) => new Map(current).set(progress.exportId ?? progress.fileName, progress))
    })
  }, [])

  const loadingCameraRef = useRef(false)
  const loadingDownloadsRef = useRef(false)
  const previewRequestIdRef = useRef(0)
  const requestedThumbnailIdsRef = useRef(new Set<string>())
  const requestedFrameRateIdsRef = useRef(new Set<string>())
  const requestFrameRateRef = useRef<(file: LunaFile, localPath: string | null | undefined) => void>(() => {})
  const activeDeviceId = activeDevice?.id ?? settings?.activeDeviceId ?? ''
  const storageOptions = [
    { value: 'all', label: '全部' },
    ...(activeDevice?.storages.map((storage) => ({
      value: storage.id,
      label: storage.label,
    })) ?? []),
  ]

  useEffect(() => {
    setStorageFilter(settings?.deviceStorage?.[activeDeviceId] ?? 'all')
  }, [activeDeviceId, settings?.deviceStorage])

  // Auto-load files: 下载页加载本地，相机页自动从设备读取
  useEffect(() => {
    if (isDownloadsPage) {
      void loadDownloadedLibrary()
    } else if (settings) {
      void loadCameraLibrary()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice?.id, isDownloadsPage, refreshKey, settings?.downloadDir, storageFilter])

  const currentFiles = isDownloadsPage
    ? (viewMode === 'export' ? exportedFiles : downloadedFiles)
    : files
  const filteredFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return currentFiles
      .filter((file) => {
        const matchesType = mediaFilter === 'all' || file.kind === mediaFilter
        const matchesQuery = !keyword || file.name.toLowerCase().includes(keyword)
        const matchesStorage = isDownloadsPage || storageFilter === 'all' || file.storageId === storageFilter
        const progress = downloadProgress.get(file.name)
        const isDownloaded = Boolean(
          file.downloadFilePath
          || file.localPath
          || progress?.status === 'done'
          || progress?.status === 'exists',
        )
        const matchesDownloadStatus = isDownloadsPage
          || downloadStatusFilter === 'all'
          || (downloadStatusFilter === 'downloaded' ? isDownloaded : !isDownloaded)
        return matchesType && matchesQuery && matchesStorage && matchesDownloadStatus
      })
      .sort((a, b) => {
        const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
        const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
        const order = sortOrder === 'desc' ? bTime - aTime : aTime - bTime
        return order || a.name.localeCompare(b.name)
      })
  }, [currentFiles, downloadProgress, downloadStatusFilter, isDownloadsPage, mediaFilter, query, sortOrder, storageFilter])
  const selectedFiles = currentFiles.filter((file) => selected.has(file.id))
  const totalSelectedBytes = selectedFiles.reduce((sum, file) => sum + (file.bytes ?? 0), 0)
  const groups = groupFiles(filteredFiles)
  const firstGroup = groups[0]?.[0] ?? null

  // Intersection observer for date groups
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

    document.querySelectorAll<HTMLElement>('.media-section[data-group]').forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [downloadStatusFilter, firstGroup, groups.length, sortOrder, mediaFilter, query])

  // 监听缓存下载完成，更新卡片缩略图
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
      // 视频缓存完成后（cacheFilePath 可用），主动请求帧率和时长
      // 即使 MediaCard 的 onLoad 重新触发也能覆盖，此处做双重保障
      const mockFile: Partial<LunaFile> = { id: fileId, cacheFilePath, kind: 'video' }
      requestFrameRateRef.current(mockFile as LunaFile, null)
    })
  }, [])

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

  function requestThumbnail(file: LunaFile): void {
    if (file.thumbnailUrl || cacheFailedIds.has(file.id) || requestedThumbnailIdsRef.current.has(file.id)) return
    requestedThumbnailIdsRef.current.add(file.id)
    void window.luna.cacheFile(file)
      .then((ok) => {
        if (!ok) setCacheFailedIds((current) => new Set(current).add(file.id))
      })
      .catch(() => setCacheFailedIds((current) => new Set(current).add(file.id)))
  }

  function requestFrameRate(file: LunaFile, localPath: string | null | undefined): void {
    const videoPath = localPath ?? file.cacheFilePath
    if (file.kind !== 'video' || !videoPath || file.duration != null || requestedFrameRateIdsRef.current.has(file.id)) return
    requestedFrameRateIdsRef.current.add(file.id)
    void window.luna.requestVideoFrameRate(file, videoPath).catch(() => {
      requestedFrameRateIdsRef.current.delete(file.id)
    })
  }

  // 保持 ref 与最新函数同步，供 onThumbnailReady 等闭包回调使用
  requestFrameRateRef.current = requestFrameRate

  function handleThumbnailImageLoad(file: LunaFile, localPath: string | null | undefined): void {
    requestThumbnail(file)
    requestFrameRate(file, localPath)
  }

  // --- File loading ---

  async function loadCameraLibrary(): Promise<void> {
    if (!settings) return
    if (loadingCameraRef.current) return
    loadingCameraRef.current = true
    setLoadingFiles(true)
    const t0 = performance.now()
    try {
      const host = settings.cameraHost
      await window.luna.checkConnection(host)
      // listFiles 只做轻量本地路径/已有缩略图标记，缓存由渲染层按需发起
      const lunaFiles = await window.luna.listFiles(host, storageFilter)
      const t1 = performance.now()
      console.log(`[timing] loadCameraLibrary: ${(t1 - t0).toFixed(0)}ms (checkConnection + listFiles IPC)`)
      setFiles(lunaFiles)
      setSelected(new Set())
      setCacheFailedIds(new Set())
      requestedThumbnailIdsRef.current.clear()
      requestedFrameRateIdsRef.current.clear()
    } catch (error) {
      console.error(error)
    } finally {
      loadingCameraRef.current = false
      setLoadingFiles(false)
    }
  }

  async function handleStorageFilterChange(value: StorageFilter): Promise<void> {
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

  async function loadDownloadedLibrary(): Promise<void> {
    if (!settings?.downloadDir) return
    if (loadingDownloadsRef.current) return
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

  useEffect(() => {
    if (isDownloadsPage && viewMode === 'export') {
      void loadExportLibrary()
    }
  }, [isDownloadsPage, viewMode, settings?.exportDir])

  const {
    deleteSelectedLocalFiles,
    downloadOne,
    exportLocalFiles,
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
    setExportError,
    setExportedFiles,
    setExporting,
    setExportProgress,
    setExportSnapshots,
    setFiles,
    setPreviewFile,
    setPreviewFiles,
    setSelected,
    setShowDeleteDialog,
    viewMode,
    loadDownloadedLibrary,
    loadExportLibrary,
  })

  async function openPreview(file: LunaFile, options?: { playLive?: boolean; keepPreviewFiles?: boolean; previewFiles?: LunaFile[] }): Promise<void> {
    const requestId = previewRequestIdRef.current + 1
    previewRequestIdRef.current = requestId
    if (!options?.keepPreviewFiles) {
      setPreviewFiles(options?.previewFiles ?? filteredFiles)
    }
    setPreviewFile(file)
    setPreview(null)
    setAutoPlayLiveFileId(options?.playLive ? file.id : null)
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

  // --- Selection ---

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

  function handlePreviewClick(file: LunaFile): void {
    void openPreview(file, { previewFiles: filteredFiles })
  }

  function revealDownloadedFile(progress: DownloadProgress | undefined): void {
    if (progress?.destinationPath) {
      void window.luna.revealFile(progress.destinationPath)
    }
  }

  function revealFileByPath(path: string): void {
    void window.luna.revealFile(path)
  }

  // --- Preview navigation ---
  // navigation now handled internally by PreviewModal via files + currentFileId

  const progressForPreview = previewFile ? downloadProgress.get(previewFile.name) : undefined
  const isCurrentLoading = isDownloadsPage ? loadingDownloads : loadingFiles

  return {
    activeDownloadFileNames,
    activeGroup,
    autoPlayLiveFileId,
    cacheFailedIds,
    cardSize,
    deleteError,
    deletingLocalFiles,
    downloadQueue,
    downloadStatusFilter,
    exportError,
    exportProgress,
    exportSnapshots,
    exporting,
    exportWatermarkSettings,
    filteredFiles,
    firstGroup,
    groups,
    isCurrentLoading,
    mediaFilter,
    previewFiles,
    progressForPreview,
    selected,
    selectedFiles,
    showDeleteDialog,
    showExportDialog,
    sortOrder,
    storageFilter,
    storageOptions,
    totalSelectedBytes,
    viewMode,
    deleteSelectedLocalFiles,
    downloadOne,
    exportLocalFiles,
    handlePreviewClick,
    handleStorageFilterChange,
    handleThumbnailImageLoad,
    loadCameraLibrary,
    loadDownloadedLibrary,
    loadExportLibrary,
    markFileDownloaded,
    openPreview,
    restoreDownloadedRecords,
    revealDownloadedFile,
    revealFileByPath,
    setActiveDownloadFileNames,
    setCardSize,
    setDeleteError,
    setDownloadQueue,
    setDownloadStatusFilter,
    setExportError,
    setExporting,
    setExportProgress,
    setExportWatermarkSettings,
    setMediaFilter,
    setPreviewFiles,
    setSelected,
    setShowDeleteDialog,
    setShowExportDialog,
    setSortOrder,
    setViewMode,
    startDownload,
    toggleFile,
    toggleGroup,
  }
}
