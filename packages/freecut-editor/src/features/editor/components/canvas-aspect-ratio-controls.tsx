import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Ratio } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@freecut/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@freecut/components/ui/dropdown-menu'
import { EDITOR_LAYOUT_CSS_VALUES } from '@freecut/config/editor-layout'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  findCanvasAspectRatioPreset,
  resizeCanvasToAspectRatio,
} from '@freecut/shared/projects/canvas-aspect-ratio'
import { commitProjectMetadataChange } from '../utils/project-metadata-history'

function isVisualMedia(item: { mimeType: string; width: number; height: number }): boolean {
  return (
    (item.mimeType.startsWith('video/') || item.mimeType.startsWith('image/')) &&
    item.width > 0 &&
    item.height > 0
  )
}

export function CanvasAspectRatioControls() {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const currentProject = useProjectStore((state) => state.currentProject)
  const updateProject = useProjectStore((state) => state.updateProject)
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  const markDirty = useTimelineStore((state) => state.markDirty)
  const setZoom = usePlaybackStore((state) => state.setZoom)

  const originalMedia = mediaItems
    .filter(isVisualMedia)
    .toSorted((left, right) => left.createdAt - right.createdAt)[0]
  const currentPreset = currentProject
    ? findCanvasAspectRatioPreset(currentProject.metadata.width, currentProject.metadata.height)
    : undefined
  const originalRatio = originalMedia ? originalMedia.width / originalMedia.height : null
  const originalIsActive =
    currentProject !== null &&
    originalRatio !== null &&
    Math.abs(currentProject.metadata.width / currentProject.metadata.height - originalRatio) /
      originalRatio <
      0.005
  const currentLabel = currentPreset?.label ?? t('preview.canvasRatio.custom')

  const blurTrigger = useCallback(() => {
    triggerRef.current?.blur()
  }, [])

  const applyAspectRatio = useCallback(
    async (aspectRatio: number, operation: string) => {
      if (!currentProject) return
      const nextSize = resizeCanvasToAspectRatio(currentProject.metadata, aspectRatio)

      try {
        await commitProjectMetadataChange({
          project: currentProject,
          updates: nextSize,
          command: {
            type: 'UPDATE_PROJECT_METADATA',
            payload: { fields: ['width', 'height'], operation },
          },
          updateProject,
          markDirty,
          onApplied: () => setZoom(-1),
        })
      } catch (error) {
        toast.error(t('editor.canvasPanel.updateFailed'), {
          description: error instanceof Error ? error.message : t('editor.canvasPanel.tryAgain'),
        })
      }
    },
    [currentProject, markDirty, setZoom, t, updateProject],
  )

  if (!currentProject) return null

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) requestAnimationFrame(blurTrigger)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          className="editor-toolbar-button flex-shrink-0 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize }}
          data-tooltip={t('preview.canvasRatio.tooltip', { label: currentLabel })}
          aria-label={t('preview.canvasRatio.ariaLabel', { label: currentLabel })}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.code === 'Space') event.preventDefault()
          }}
        >
          <Ratio className="h-3.5 w-3.5" />
          <span className="text-[10px] leading-none">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-40"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(blurTrigger)
        }}
      >
        <DropdownMenuItem
          className="text-xs"
          disabled={!originalMedia}
          onSelect={() => {
            if (originalMedia) {
              void applyAspectRatio(
                originalMedia.width / originalMedia.height,
                'match-original-media-ratio',
              )
            }
          }}
        >
          <span className="w-4">
            {originalIsActive ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          {t('preview.canvasRatio.original')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {CANVAS_ASPECT_RATIO_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            className="text-xs"
            onSelect={() => void applyAspectRatio(preset.ratio, `set-aspect-ratio-${preset.id}`)}
          >
            <span className="w-4">
              {currentPreset?.id === preset.id ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
