import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  Bug,
  ChevronDown,
  Download,
  FolderArchive,
  Keyboard,
  ListVideo,
  MoreHorizontal,
  Settings,
  Video,
} from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@freecut/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@freecut/components/ui/popover'
import { Separator } from '@freecut/components/ui/separator'
import { ProjectDebugPanel } from './project-debug-panel'
import { SettingsDialog } from './settings-dialog'
import { ShortcutsDialog } from './shortcuts-dialog'
import { WorkspaceSwitcher } from './workspace-switcher'
import './toolbar.css'
import { EDITOR_LAYOUT_CSS_VALUES } from '@freecut/config/editor-layout'
import { cn } from '@freecut/shared/ui/cn'
import { useDebugStore } from '@freecut/features/editor/stores/debug-store'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'

interface ToolbarProps {
  projectId: string
  project: {
    id: string
    name: string
    width: number
    height: number
    fps: number
  }
  onSave?: () => Promise<void>
  onExport?: () => void
  onExportBundle?: () => void
  onOpenRenderQueue?: () => void
  /** Number of queued + rendering jobs, shown as a badge on the queue button. */
  renderQueueCount?: number
  locked?: boolean
}

export const Toolbar = memo(function Toolbar({
  projectId,
  project,
  onSave,
  onExport,
  onExportBundle,
  onOpenRenderQueue,
  renderQueueCount = 0,
  locked = false,
}: ToolbarProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [lunaNavHost, setLunaNavHost] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.getElementById('luna-video-editor-nav-slot'),
  )

  useEffect(() => {
    document.body.classList.add('freecut-editor-open')
    setLunaNavHost(document.getElementById('luna-video-editor-nav-slot'))

    return () => {
      document.body.classList.remove('freecut-editor-open')
    }
  }, [])

  const handleBackClick = async () => {
    try {
      if (useTimelineStore.getState().isDirty && onSave) {
        await onSave()
      }
      navigate({ to: '/projects' })
    } catch {
      // The save path reports the error. Stay in the editor so changes are not lost.
    }
  }

  const toolbar = (
    <div
      className={cn(
        'editor-toolbar panel-header flex flex-shrink-0 items-center gap-2.5',
        lunaNavHost ? 'h-full w-full px-0' : 'border-b border-border px-3',
        locked && 'pointer-events-none select-none opacity-60',
      )}
      style={{
        height: lunaNavHost ? '100%' : EDITOR_LAYOUT_CSS_VALUES.toolbarHeight,
        backgroundColor: lunaNavHost ? '#080808' : undefined,
      }}
      role="toolbar"
      aria-label={t('toolbar.ariaLabel')}
    >
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBackClick}
          data-tooltip={t('toolbar.backToProjects')}
          data-tooltip-side="right"
          aria-label={t('toolbar.backToProjectsAria')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-5" />
      </div>

      <div className="flex min-w-0 flex-[0_1_18rem] items-center justify-center px-3">
        <h1 className="max-w-full truncate text-xs font-medium leading-none" title={project?.name}>
          {project?.name || t('common.untitledProject')}
        </h1>
      </div>

      <ShortcutsDialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog} />

      <SettingsDialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog} />

      <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1.5">
        <WorkspaceSwitcher />
        {import.meta.env.DEV && import.meta.env.VITE_SHOW_DEBUG_PANEL !== 'false' && (
          <DebugPopover projectId={projectId} />
        )}

        {onOpenRenderQueue && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 relative"
            onClick={onOpenRenderQueue}
            data-tooltip={t('toolbar.renderQueue')}
            data-tooltip-side="bottom"
            aria-label={t('toolbar.renderQueueAria')}
          >
            <ListVideo className="h-4 w-4" />
            {renderQueueCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
                {renderQueueCount}
              </span>
            )}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8"
              aria-label={t('toolbar.more')}
              data-tooltip={t('toolbar.more')}
              data-tooltip-side="bottom"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate({ to: '/docs' })} className="gap-2">
              <BookOpen className="h-4 w-4" />
              {t('toolbar.userGuide')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowSettingsDialog(true)} className="gap-2">
              <Settings className="h-4 w-4" />
              {t('toolbar.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowShortcutsDialog(true)} className="gap-2">
              <Keyboard className="h-4 w-4" />
              {t('toolbar.keyboardShortcuts')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="editorAction" size="sm" className="gap-1.5 px-2.5">
              <Download className="h-4 w-4" />
              {t('toolbar.export')}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport} className="gap-2">
              <Video className="h-4 w-4" />
              {t('toolbar.exportVideo')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportBundle} className="gap-2">
              <FolderArchive className="h-4 w-4" />
              {t('toolbar.downloadProjectZip')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return lunaNavHost ? createPortal(toolbar, lunaNavHost) : toolbar
})

function DebugPopover({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const debugPanelOpen = useDebugStore((s) => s.debugPanelOpen)
  const setDebugPanelOpen = useDebugStore((s) => s.setDebugPanelOpen)

  return (
    <Popover open={debugPanelOpen} onOpenChange={setDebugPanelOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'h-7 w-7',
            debugPanelOpen && 'bg-amber-500/20 border-amber-500/50 text-amber-400',
          )}
          data-tooltip={debugPanelOpen ? undefined : t('toolbar.debugPanel')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.debugPanelAria')}
        >
          <Bug className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 p-0 bg-zinc-900 border-zinc-700 text-zinc-100"
      >
        <ProjectDebugPanel projectId={projectId} />
      </PopoverContent>
    </Popover>
  )
}
