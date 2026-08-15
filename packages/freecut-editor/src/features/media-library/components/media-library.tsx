import {
  useEffect,
  useRef,
  useState,
  useMemo,
  memo,
  useCallback,
} from 'react'
import {
  Search,
  Filter,
  ArrowUpDown,
  Video,
  FileAudio,
  Image as ImageIcon,
  Trash2,
  AlertTriangle,
  Info,
  X,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Film,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
  Sparkles,
  FileText,
  FileJson,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@freecut/shared/logging/logger'
import { useEmbeddedHost } from '@freecut/shared/host/embedded-host'
import { createNativeMediaFileHandle } from '@freecut/shared/host/native-media-file-handle'

const logger = createLogger('MediaLibrary')
import { Button } from '@freecut/components/ui/button'
import { Input } from '@freecut/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@freecut/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@freecut/components/ui/alert-dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@freecut/components/ui/collapsible'
import { MarqueeOverlay } from '@freecut/shared/marquee/marquee-overlay'
import { cn } from '@freecut/shared/ui/cn'
import { GridMediaGrid, ListMediaGrid } from './media-grid'
import { CompositionsSection } from './compositions-section'
import { BackgroundTaskProgress } from './background-task-progress'
import { MissingMediaDialog } from './missing-media-dialog'
import { OrphanedClipsDialog } from './orphaned-clips-dialog'
import { UnsupportedAudioCodecDialog } from './unsupported-audio-codec-dialog'
import { useFilteredMediaItems, useMediaLibraryStore } from '../stores/media-library-store'
import {
  useCompositionsStore,
  useCompositionNavigationStore,
} from '@freecut/features/media-library/deps/timeline-stores'
import { useProjectStore } from '@freecut/features/media-library/deps/projects'
import { proxyService } from '../services/proxy-service'
import { frameInterpolationService } from '../services/frame-interpolation-service'
import { upscaleService } from '../services/upscale-service'
import { cancelMediaTranscriptionJob } from '../services/media-transcription-runner'
import { importMediaAnalysisService } from '../services/media-analysis-service-loader'
import { getSharedProxyKey } from '../utils/proxy-key'
import { getMediaType } from '../utils/validation'
import { getProjectBrokenMediaIds } from '@freecut/features/media-library/utils/broken-media'
import type { MediaMetadata } from '@freecut/types/storage'
import { isMarqueeJustFinished } from '@freecut/shared/marquee/use-marquee-selection'
import { useMediaLibraryMarquee } from './use-media-library-marquee'
import { useMediaLibraryDragDrop } from './use-media-library-drag-drop'
import { useMediaTaskProgress } from './use-media-task-progress'
import { useMediaLibraryDeletion } from './use-media-library-deletion'
import { MediaImportDropOverlay } from './media-import-empty-state'
import type { ExtractedMediaFileEntry } from '../utils/file-drop'

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted transition-colors"
      title={t('media.library.copyToClipboard')}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  )
}

const GROUP_ICONS = {
  video: Video,
  audio: FileAudio,
  image: ImageIcon,
  gif: Film,
  lottie: FileJson,
} as const

interface MediaTypeGroupProps {
  groupKey: string
  label: string
  icon: keyof typeof GROUP_ICONS
  items: MediaMetadata[]
  isOpen: boolean
  onToggle: (key: string, open: boolean) => void
  onMediaSelect?: (mediaId: string) => void
  itemSize: number
}

interface MediaTypeGroupBaseProps extends MediaTypeGroupProps {
  Grid: typeof GridMediaGrid | typeof ListMediaGrid
}

const GridMediaTypeGroup = memo(function GridMediaTypeGroup(props: MediaTypeGroupProps) {
  return <MediaTypeGroupBase {...props} Grid={GridMediaGrid} />
})

const ListMediaTypeGroup = memo(function ListMediaTypeGroup(props: MediaTypeGroupProps) {
  return <MediaTypeGroupBase {...props} Grid={ListMediaGrid} />
})

const MediaTypeGroupBase = memo(function MediaTypeGroupBase({
  groupKey,
  label,
  icon,
  items,
  isOpen,
  onToggle,
  onMediaSelect,
  itemSize,
  Grid,
}: MediaTypeGroupBaseProps) {
  const Icon = GROUP_ICONS[icon]
  return (
    <Collapsible open={isOpen} onOpenChange={(open) => onToggle(groupKey, open)}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
        <ChevronRight
          className={cn(
            'w-3 h-3 text-muted-foreground transition-transform',
            isOpen && 'rotate-90',
          )}
        />
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2">
        <Grid items={items} onMediaSelect={onMediaSelect} itemSize={itemSize} />
      </CollapsibleContent>
    </Collapsible>
  )
})

interface MediaLibraryProps {
  onMediaSelect?: (mediaId: string) => void
}

/**
 * Per-item rows shown when a background-task progress bar is expanded. A single row carries no
 * more information than the aggregate bar above it, so one row renders nothing.
 */
function renderTaskDetailRows(
  rows: ReadonlyArray<{ id: string; name: string; percent: number }>,
): React.ReactNode {
  if (rows.length <= 1) return undefined
  return rows.map((row) => (
    <div
      key={row.id}
      className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
    >
      <span className="truncate">{row.name}</span>
      <span className="tabular-nums flex-shrink-0">{row.percent}%</span>
    </div>
  ))
}

export const MediaLibrary = memo(function MediaLibrary({ onMediaSelect }: MediaLibraryProps) {
  const { t } = useTranslation()
  const { requestMediaImport, describeDroppedMediaFiles } = useEmbeddedHost()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const importInFlightRef = useRef(false)
  const [isImporting, setIsImporting] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(['video', 'audio', 'image', 'gif', 'lottie']),
  )
  // Store selectors
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId)
  const setCurrentProject = useMediaLibraryStore((s) => s.setCurrentProject)
  const loadMediaItems = useMediaLibraryStore((s) => s.loadMediaItems)
  const importMedia = useMediaLibraryStore((s) => s.importMedia)
  const importHandles = useMediaLibraryStore((s) => s.importHandles)
  const deleteMediaBatch = useMediaLibraryStore((s) => s.deleteMediaBatch)
  const showNotification = useMediaLibraryStore((s) => s.showNotification)
  const searchQuery = useMediaLibraryStore((s) => s.searchQuery)
  const setSearchQuery = useMediaLibraryStore((s) => s.setSearchQuery)
  const filterByType = useMediaLibraryStore((s) => s.filterByType)
  const setFilterByType = useMediaLibraryStore((s) => s.setFilterByType)
  const sortBy = useMediaLibraryStore((s) => s.sortBy)
  const setSortBy = useMediaLibraryStore((s) => s.setSortBy)
  const viewMode = useMediaLibraryStore((s) => s.viewMode)
  const mediaItemSize = useMediaLibraryStore((s) => s.mediaItemSize)
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds)
  const selectedCompositionIds = useMediaLibraryStore((s) => s.selectedCompositionIds)
  const setSelection = useMediaLibraryStore((s) => s.setSelection)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const clearSelection = useMediaLibraryStore((s) => s.clearSelection)
  const error = useMediaLibraryStore((s) => s.error)
  const errorLink = useMediaLibraryStore((s) => s.errorLink)
  const clearError = useMediaLibraryStore((s) => s.clearError)
  const notification = useMediaLibraryStore((s) => s.notification)
  const clearNotification = useMediaLibraryStore((s) => s.clearNotification)
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds)
  const openMissingMediaDialog = useMediaLibraryStore((s) => s.openMissingMediaDialog)
  const projectStoreProjectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus)
  const filteredMediaItems = useFilteredMediaItems()
  const mediaGroups = useMemo(() => {
    const groups: {
      key: string
      label: string
      icon: 'video' | 'audio' | 'image' | 'gif' | 'lottie'
      items: MediaMetadata[]
    }[] = []
    const videos: MediaMetadata[] = []
    const audio: MediaMetadata[] = []
    const gifs: MediaMetadata[] = []
    const images: MediaMetadata[] = []
    const lotties: MediaMetadata[] = []
    for (const item of filteredMediaItems) {
      if (item.mimeType === 'image/gif') {
        gifs.push(item)
      } else {
        const t = getMediaType(item.mimeType)
        if (t === 'video') videos.push(item)
        else if (t === 'audio') audio.push(item)
        else if (t === 'lottie') lotties.push(item)
        else images.push(item)
      }
    }
    if (videos.length > 0)
      groups.push({
        key: 'video',
        label: t('media.library.groupVideos'),
        icon: 'video',
        items: videos,
      })
    if (audio.length > 0)
      groups.push({
        key: 'audio',
        label: t('media.library.groupAudio'),
        icon: 'audio',
        items: audio,
      })
    if (images.length > 0)
      groups.push({
        key: 'image',
        label: t('media.library.groupImages'),
        icon: 'image',
        items: images,
      })
    if (gifs.length > 0)
      groups.push({ key: 'gif', label: t('media.library.groupGifs'), icon: 'gif', items: gifs })
    if (lotties.length > 0)
      groups.push({
        key: 'lottie',
        label: t('media.library.groupLottie'),
        icon: 'lottie',
        items: lotties,
      })
    return groups
  }, [filteredMediaItems, t])
  const compositions = useCompositionsStore((s) => s.compositions)
  const MediaTypeGroupView = viewMode === 'grid' ? GridMediaTypeGroup : ListMediaTypeGroup
  const EmptyMediaGrid = viewMode === 'grid' ? GridMediaGrid : ListMediaGrid

  // Composition navigation — show banner when inside a sub-comp
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId)
  const breadcrumbs = useCompositionNavigationStore((s) => s.breadcrumbs)
  const exitComposition = useCompositionNavigationStore((s) => s.exitComposition)
  const activeCompLabel = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 1]?.label : null

  // Unsupported codec dialog state
  const unsupportedCodecFiles = useMediaLibraryStore((s) => s.unsupportedCodecFiles)
  const showUnsupportedCodecDialog = useMediaLibraryStore((s) => s.showUnsupportedCodecDialog)
  const resolveUnsupportedCodecDialog = useMediaLibraryStore((s) => s.resolveUnsupportedCodecDialog)

  // HMR recovery: if media store lost project context, rehydrate it from project store.
  useEffect(() => {
    if (!currentProjectId && projectStoreProjectId) {
      setCurrentProject(projectStoreProjectId)
      void loadMediaItems().catch((error) => {
        logger.error('Failed to load media library during store recovery:', error)
      })
    }
  }, [currentProjectId, loadMediaItems, projectStoreProjectId, setCurrentProject])

  const selectedAssetCount = selectedMediaIds.length + selectedCompositionIds.length
  const { marquee } = useMediaLibraryMarquee({
    compositions,
    filteredMediaItems,
    selectedMediaIds,
    selectedCompositionIds,
    scrollContainerRef,
    setSelection,
  })

  const {
    showDeleteDialog,
    setShowDeleteDialog,
    pendingDeletion,
    setPendingDeletion,
    deleteAssetCount,
    isMediaOnlyDeletion,
    deleteSummary,
    affectedAssetInstanceCount,
    handleDeleteSelected,
    handleConfirmDelete,
  } = useMediaLibraryDeletion({
    containerRef,
    selectedMediaIds,
    selectedCompositionIds,
    selectedAssetCount,
    currentProjectId,
    clearSelection,
    deleteMediaBatch,
  })

  const runImport = useCallback(async (operation: () => Promise<unknown>) => {
    if (importInFlightRef.current) return
    importInFlightRef.current = true
    setIsImporting(true)
    try {
      await operation()
    } finally {
      importInFlightRef.current = false
      setIsImporting(false)
    }
  }, [])

  // Picker, empty state, and host integration all share this import path.
  const handleImport = useCallback(async () => {
    try {
      await runImport(async () => {
        if (requestMediaImport) {
          await requestMediaImport(async (sources, options) => {
            await importHandles(sources.map(createNativeMediaFileHandle), {
              storageMode: 'link',
              background: options?.background,
            })
          })
          return
        }

        await importMedia({ storageMode: 'link' })
      })
    } catch (error) {
      logger.error('Import failed:', error)
    }
  }, [importHandles, importMedia, requestMediaImport, runImport])

  // Import files from drag-drop handles - memoized to prevent MediaGrid re-renders
  const handleImportEntries = useCallback(
    async (entries: ExtractedMediaFileEntry[]) => {
      try {
        await runImport(async () => {
          if (describeDroppedMediaFiles) {
            const sources = await describeDroppedMediaFiles(entries.map((entry) => entry.file))
            await importHandles(sources.map(createNativeMediaFileHandle), { storageMode: 'link' })
            return
          }
          await importHandles(entries.map((entry) => entry.handle), { storageMode: 'link' })
        })
      } catch (error) {
        logger.error('Import failed:', error)
      }
    },
    [describeDroppedMediaFiles, importHandles, runImport],
  )

  // Panel-level drag/drop handling so the drop zone covers the full panel height.
  const { isDragging, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } =
    useMediaLibraryDragDrop({ showNotification, importEntries: handleImportEntries })

  // Count of items currently generating proxies
  const currentProjectBrokenMediaIds = useMemo(
    () => getProjectBrokenMediaIds(brokenMediaIds, mediaById),
    [brokenMediaIds, mediaById],
  )

  const {
    analysisProgress,
    analysisPercent,
    generatingCount,
    generatingAvgProgress,
    proxyItemRows,
    interpolatingCount,
    interpolatingAvgProgress,
    interpolationItemRows,
    interpolationEtaLabel,
    isDownloadingInterpolationModel,
    upscalingCount,
    upscalingAvgProgress,
    upscaleItemRows,
    upscaleEtaLabel,
    transcribingCount,
    transcribingAvgProgress,
    singleTranscriptionStageLabel,
    singleTranscriptionDetail,
    singleTranscriptionIndeterminate,
    transcriptionItemRows,
    preparationItemRows,
    preparingCount,
    preparingAvgProgress,
    hasRunningPreparationTasks,
  } = useMediaTaskProgress()

  const handleCancelAllProxies = () => {
    for (const [mediaId, status] of proxyStatus.entries()) {
      if (status !== 'generating') {
        continue
      }

      const media = mediaById[mediaId]
      proxyService.cancelProxy(mediaId, media ? getSharedProxyKey(media) : undefined)
    }
  }

  const handleCancelAllInterpolation = () => {
    for (const [mediaId, status] of useMediaLibraryStore.getState().interpolationStatus.entries()) {
      if (status === 'generating') {
        frameInterpolationService.cancel(mediaId)
      }
    }
  }

  const handleCancelAllUpscales = () => {
    for (const [mediaId, status] of useMediaLibraryStore.getState().upscaleStatus.entries()) {
      if (status === 'generating') {
        upscaleService.cancel(mediaId)
      }
    }
  }

  const handleCancelAllTranscriptions = () => {
    for (const [mediaId, status] of transcriptStatus.entries()) {
      if (status !== 'queued' && status !== 'transcribing') {
        continue
      }

      cancelMediaTranscriptionJob(mediaId)
    }
  }

  const handleScrollContentClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isMarqueeJustFinished()) return

      const target = event.target as HTMLElement
      if (!target.closest('[data-media-id], [data-composition-id]')) {
        clearSelection()
      }
    },
    [clearSelection],
  )

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant="editorAction"
          size="sm"
          onClick={() => void handleImport()}
          disabled={!currentProjectId || isImporting}
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
        >
          {isImporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5" />
          )}
          {isImporting ? t('media.grid.importingButton') : t('media.library.import')}
        </Button>

        <div className="group relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input
            placeholder={t('media.searchMedia')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-8 border-border bg-secondary pl-8 pr-7 text-xs placeholder:text-muted-foreground focus:border-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t('editor.mediaSidebar.clearSearch')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'h-8 shrink-0 gap-1 border-border bg-secondary px-2 text-muted-foreground',
                filterByType && 'border-primary/60 text-primary',
              )}
              aria-label={t('media.library.allTypes')}
            >
              <Filter className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setFilterByType(null)}>
              {t('media.library.allTypes')}
              {!filterByType && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterByType('video')}>
              <Video className="mr-2 h-3.5 w-3.5" />
              {t('media.type.video')}
              {filterByType === 'video' && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterByType('audio')}>
              <FileAudio className="mr-2 h-3.5 w-3.5" />
              {t('media.type.audio')}
              {filterByType === 'audio' && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterByType('image')}>
              <ImageIcon className="mr-2 h-3.5 w-3.5" />
              {t('media.type.image')}
              {filterByType === 'image' && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            {currentProjectBrokenMediaIds.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openMissingMediaDialog} className="text-destructive">
                  {t('media.library.viewMissingMedia', {
                    count: currentProjectBrokenMediaIds.length,
                  })}
                </DropdownMenuItem>
              </>
            )}
            {selectedAssetCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDeleteSelected} className="text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {t('common.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 border-border bg-secondary px-2 text-muted-foreground"
              aria-label={t(`media.library.sort${sortBy === 'date' ? 'Date' : sortBy === 'name' ? 'Name' : 'Size'}`)}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setSortBy('date')}>
              {t('media.library.sortDate')}
              {sortBy === 'date' && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy('name')}>
              {t('media.library.sortName')}
              {sortBy === 'name' && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy('size')}>
              {t('media.library.sortSize')}
              {sortBy === 'size' && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-destructive/10 border border-destructive/50 rounded text-xs animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-start justify-between gap-2">
            <div className="text-destructive leading-relaxed flex-1">
              <p>{error}</p>
              {errorLink && (
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground select-text">
                    {errorLink}
                  </code>
                  <CopyButton text={errorLink} />
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
              className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              {t('media.library.dismiss')}
            </Button>
          </div>
        </div>
      )}

      {/* Notification message */}
      {notification && (
        <div
          className={`mx-4 mt-3 p-2.5 rounded text-xs animate-in slide-in-from-top-2 duration-200 ${
            notification.type === 'info'
              ? 'bg-primary/10 border border-primary/30'
              : notification.type === 'warning'
                ? 'bg-yellow-500/10 border border-yellow-500/30'
                : notification.type === 'success'
                  ? 'bg-green-500/10 border border-green-500/30'
                  : 'bg-destructive/10 border border-destructive/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Info
                className={`w-3.5 h-3.5 flex-shrink-0 ${
                  notification.type === 'info'
                    ? 'text-primary'
                    : notification.type === 'warning'
                      ? 'text-yellow-500'
                      : notification.type === 'success'
                        ? 'text-green-500'
                        : 'text-destructive'
                }`}
              />
              <p
                className={`leading-relaxed line-clamp-2 ${
                  notification.type === 'info'
                    ? 'text-primary'
                    : notification.type === 'warning'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : notification.type === 'success'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-destructive'
                }`}
              >
                {notification.message}
              </p>
            </div>
            <button
              onClick={clearNotification}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Composition navigation banner — shown when inside a sub-composition */}
      {activeCompositionId !== null && activeCompLabel && (
        <div className="px-3 py-1.5 border-b border-violet-500/30 bg-violet-500/10 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={exitComposition}
            className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('media.library.back')}</span>
          </button>
          <span className="text-xs text-violet-400/60">/</span>
          <span className="text-xs text-violet-300 font-medium truncate">{activeCompLabel}</span>
        </div>
      )}

      {/* Scrollable content: wrapper provides relative context for the drag overlay */}
      <div className="flex-1 relative min-h-0">
        <div
          ref={scrollContainerRef}
          className="relative h-full overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]"
          onClick={handleScrollContentClick}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <MarqueeOverlay marquee={marquee} />

          {/* Compositions section — collapsible, auto-hidden when empty */}
          <CompositionsSection />

          {/* Media sections — grouped by type */}
          {mediaGroups.map((group) => (
            <MediaTypeGroupView
              key={group.key}
              groupKey={group.key}
              label={group.label}
              icon={group.icon}
              items={group.items}
              isOpen={openGroups.has(group.key)}
              onToggle={(key, open) =>
                setOpenGroups((prev) => {
                  const next = new Set(prev)
                  if (open) next.add(key)
                  else next.delete(key)
                  return next
                })
              }
              onMediaSelect={onMediaSelect}
              itemSize={mediaItemSize}
            />
          ))}

          {/* Loading / empty state when no groups to show */}
          {mediaGroups.length === 0 && (
            <EmptyMediaGrid
              onMediaSelect={onMediaSelect}
              itemSize={mediaItemSize}
              onImport={() => void handleImport()}
              isImporting={isImporting}
            />
          )}
        </div>

        {/* Drag overlay — absolute sibling, always covers the visible viewport */}
        {isDragging && <MediaImportDropOverlay />}
      </div>

      {/* Background AI analysis status */}
      {analysisProgress && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin flex-shrink-0" />}
          label={
            analysisProgress.total > 1
              ? t('media.library.analyzingMultiple', {
                  current: Math.min(analysisProgress.completed + 1, analysisProgress.total),
                  total: analysisProgress.total,
                })
              : t('media.library.analyzingSingle')
          }
          progressAriaLabel={t('media.library.aiAnalysisProgress')}
          progressPercent={analysisPercent}
          meta={
            <>
              <span className="tabular-nums">{Math.round(analysisPercent)}%</span>
              {!analysisProgress.cancelRequested ? (
                <button
                  type="button"
                  onClick={() => {
                    void importMediaAnalysisService().then(({ mediaAnalysisService }) =>
                      mediaAnalysisService.requestCancel(),
                    )
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {analysisProgress.total > 1 ? t('media.library.cancelAll') : t('common.cancel')}
                </button>
              ) : (
                <span className="text-muted-foreground/80">{t('media.library.cancelling')}</span>
              )}
            </>
          }
          trailing={<Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
          fillClassName="bg-purple-500"
        />
      )}

      {/* Unified media readiness progress bar */}
      {preparingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Film className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />}
          label={t('media.library.preparingMediaWithCount', { count: preparingCount })}
          progressAriaLabel={t('media.library.mediaPreparationProgress')}
          progressPercent={preparingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={
            preparationItemRows.length > 1
              ? preparationItemRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      <span className="hidden sm:inline">{row.kind}</span>
                      <span className="tabular-nums">
                        {row.status === 'queued'
                          ? t('media.library.preparationQueued')
                          : `${row.percent}%`}
                      </span>
                    </span>
                  </div>
                ))
              : undefined
          }
          meta={
            <span className="tabular-nums">
              {hasRunningPreparationTasks
                ? `${Math.round(preparingAvgProgress * 100)}%`
                : t('media.library.preparationQueued')}
            </span>
          }
          fillClassName="bg-cyan-500"
        />
      )}

      {/* Transcript generation progress bar */}
      {transcribingCount > 0 && (
        <BackgroundTaskProgress
          icon={<FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
          // With one job the stage ("Downloading model") is far more useful than the generic
          // title, and the panel is too narrow to show both without truncating each to noise.
          label={
            singleTranscriptionStageLabel ??
            t('media.library.generatingTranscripts', { count: transcribingCount })
          }
          progressAriaLabel={t('media.library.transcriptGenerationProgress')}
          progressPercent={transcribingAvgProgress * 100}
          indeterminate={singleTranscriptionIndeterminate}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={
            transcriptionItemRows.length > 1
              ? transcriptionItemRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      {row.stage && <span className="hidden sm:inline">{row.stage}</span>}
                      <span className="tabular-nums">{row.percent}%</span>
                    </span>
                  </div>
                ))
              : undefined
          }
          meta={
            <>
              {singleTranscriptionDetail && (
                <span className="truncate tabular-nums">{singleTranscriptionDetail}</span>
              )}
              {/* The byte counter already says how far along the transfer is, and the fill bar
                  shows it too; a percent as well only crowds out the counter in a narrow panel. */}
              {!singleTranscriptionIndeterminate && !singleTranscriptionDetail && (
                <span className="tabular-nums">{Math.round(transcribingAvgProgress * 100)}%</span>
              )}
              <button
                type="button"
                onClick={handleCancelAllTranscriptions}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('media.library.cancelAll')}
              </button>
            </>
          }
          fillClassName="bg-blue-500"
        />
      )}

      {/* Proxy generation progress bar */}
      {generatingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-green-500 animate-spin flex-shrink-0" />}
          label={t('media.library.generatingProxies', { count: generatingCount })}
          progressAriaLabel={t('media.library.proxyGenerationProgress')}
          progressPercent={generatingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={renderTaskDetailRows(proxyItemRows)}
          meta={
            <>
              <span className="tabular-nums">{Math.round(generatingAvgProgress * 100)}%</span>
              <button
                type="button"
                onClick={handleCancelAllProxies}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('media.library.cancelAll')}
              </button>
            </>
          }
          fillClassName="bg-green-500"
        />
      )}

      {interpolatingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin flex-shrink-0" />}
          label={
            isDownloadingInterpolationModel
              ? t('media.library.downloadingInterpolationModel')
              : t('media.library.interpolatingFrames', { count: interpolatingCount })
          }
          progressAriaLabel={t('media.library.interpolationProgress')}
          progressPercent={interpolatingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={renderTaskDetailRows(interpolationItemRows)}
          meta={
            <>
              <span className="tabular-nums">{Math.round(interpolatingAvgProgress * 100)}%</span>
              {interpolationEtaLabel && !isDownloadingInterpolationModel && (
                <span className="text-muted-foreground tabular-nums">{interpolationEtaLabel}</span>
              )}
              <button
                type="button"
                onClick={handleCancelAllInterpolation}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('media.library.cancelAll')}
              </button>
            </>
          }
          fillClassName="bg-sky-500"
        />
      )}

      {upscalingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin flex-shrink-0" />}
          label={t('media.library.upscalingVideo', { count: upscalingCount })}
          progressAriaLabel={t('media.library.upscaleProgress')}
          progressPercent={upscalingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={renderTaskDetailRows(upscaleItemRows)}
          meta={
            <>
              <span className="tabular-nums">{Math.round(upscalingAvgProgress * 100)}%</span>
              {upscaleEtaLabel && (
                <span className="text-muted-foreground tabular-nums">{upscaleEtaLabel}</span>
              )}
              <button
                type="button"
                onClick={handleCancelAllUpscales}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('media.library.cancelAll')}
              </button>
            </>
          }
          fillClassName="bg-violet-500"
        />
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open)
          if (!open) {
            setPendingDeletion({ mediaIds: [], compositionIds: [] })
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isMediaOnlyDeletion
                ? pendingDeletion.mediaIds.length > 1
                  ? t('media.deleteDialog.titleMultiple', {
                      count: pendingDeletion.mediaIds.length,
                    })
                  : t('media.deleteDialog.titleSingle')
                : t('media.library.deleteAssetsTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {isMediaOnlyDeletion
                    ? pendingDeletion.mediaIds.length > 1
                      ? t('media.deleteDialog.bodyMultiple', {
                          count: pendingDeletion.mediaIds.length,
                        })
                      : t('media.deleteDialog.bodySingle', {
                          name: mediaById[pendingDeletion.mediaIds[0] ?? '']?.fileName ?? '',
                        })
                    : t('media.library.deleteAssetsBody', {
                        summary:
                          deleteSummary ||
                          t('media.library.selectedAssetsCount', { count: deleteAssetCount }),
                      })}
                </p>
                {affectedAssetInstanceCount > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">
                        {isMediaOnlyDeletion
                          ? t('media.deleteDialog.timelineClipsRemoved')
                          : t('media.library.linkedInstancesTitle')}
                      </p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {isMediaOnlyDeletion
                          ? t('media.deleteDialog.timelineClipsDetail', {
                              count: affectedAssetInstanceCount,
                            })
                          : t('media.library.linkedInstancesDetail', {
                              count: affectedAssetInstanceCount,
                            })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isMediaOnlyDeletion
                ? affectedAssetInstanceCount > 0
                  ? t('media.deleteDialog.confirmWithClips', {
                      count: affectedAssetInstanceCount,
                    })
                  : t('common.delete')
                : affectedAssetInstanceCount > 0
                  ? t('media.library.deleteWithClips', {
                      summary:
                        deleteSummary ||
                        t('media.library.assetsCount', { count: deleteAssetCount }),
                      count: affectedAssetInstanceCount,
                    })
                  : t('media.library.deleteSummary', {
                      summary:
                        deleteSummary ||
                        t('media.library.assetsCount', { count: deleteAssetCount }),
                    })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Missing Media Dialog */}
      <MissingMediaDialog />

      {/* Orphaned Clips Dialog */}
      <OrphanedClipsDialog />

      {/* Unsupported Audio Codec Dialog */}
      <UnsupportedAudioCodecDialog
        open={showUnsupportedCodecDialog}
        files={unsupportedCodecFiles.map((f) => ({
          fileName: f.fileName,
          audioCodec: f.audioCodec,
        }))}
        onConfirm={() => resolveUnsupportedCodecDialog(true)}
        onCancel={() => resolveUnsupportedCodecDialog(false)}
      />
    </div>
  )
})
