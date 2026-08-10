import { memo, useCallback, useMemo } from 'react'
import { Captions } from 'lucide-react'
import { i18n } from '@freecut/i18n'

import { Label } from '@freecut/components/ui/label'
import { Switch } from '@freecut/components/ui/switch'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import type {
  AudioItem,
  TextItem,
  TimelineItem,
  TimelineTranscriptCaptionStyle,
  VideoItem,
} from '@freecut/types/timeline'

import { CaptionStyleControls } from './caption-style-controls'
import { VirtualCueList } from './subtitle-cue-list'
import { PropertySection } from '../components'

interface SubtitleSectionProps {
  items: TimelineItem[]
}

interface CanvasContext {
  width: number
  height: number
}

interface SubtitleSectionPropsWithCanvas extends SubtitleSectionProps {
  canvas?: CanvasContext
}

export const SubtitleSection = memo(function SubtitleSection({
  items,
  canvas,
}: SubtitleSectionPropsWithCanvas) {
  const virtualTranscriptClips = useMemo(
    () =>
      items.filter(
        (
          item,
        ): item is (AudioItem | VideoItem) & {
          transcriptCaptions: NonNullable<(AudioItem | VideoItem)['transcriptCaptions']>
        } =>
          (item.type === 'video' || item.type === 'audio') &&
          item.isReversed !== true &&
          item.transcriptCaptions?.type === 'transcript' &&
          item.transcriptCaptions.cues.length > 0,
      ),
    [items],
  )

  if (virtualTranscriptClips.length === 0) return null

  const canvasWidth = canvas?.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = canvas?.height ?? DEFAULT_PROJECT_HEIGHT

  return (
    <VirtualTranscriptSubtitleEditor
      clips={virtualTranscriptClips}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
    />
  )
})

type VirtualTranscriptCaptionClip = (AudioItem | VideoItem) & {
  transcriptCaptions: NonNullable<(AudioItem | VideoItem)['transcriptCaptions']>
}

interface VirtualTranscriptSubtitleEditorProps {
  clips: VirtualTranscriptCaptionClip[]
  canvasWidth: number
  canvasHeight: number
}

const VirtualTranscriptSubtitleEditor = memo(function VirtualTranscriptSubtitleEditor({
  clips,
  canvasWidth,
  canvasHeight,
}: VirtualTranscriptSubtitleEditorProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)
  const fps = useTimelineStore((s) => s.fps)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const firstClip = clips[0]!
  const totalCues = clips.reduce((sum, clip) => sum + clip.transcriptCaptions.cues.length, 0)
  const captionsVisible = clips.every((clip) => clip.transcriptCaptions.enabled)

  const styleSample = useMemo<TextItem>(() => {
    const style = firstClip.transcriptCaptions.style ?? {}
    return {
      id: `${firstClip.id}:transcript-captions-style`,
      type: 'text',
      text: '',
      textRole: 'caption',
      trackId: firstClip.trackId,
      from: firstClip.from,
      durationInFrames: firstClip.durationInFrames,
      label: i18n.t('editor.subtitleSection.transcript'),
      mediaId: firstClip.mediaId,
      captionSource: {
        type: 'transcript',
        mediaId: firstClip.transcriptCaptions.mediaId,
        clipId: firstClip.id,
      },
      color: style.color ?? '#ffffff',
      ...style,
    }
  }, [firstClip])

  const styleItems = useMemo(() => [styleSample], [styleSample])

  const applyStylePatch = useCallback(
    (patch: Partial<TextItem>) => {
      for (const clip of clips) {
        updateItem(clip.id, {
          transcriptCaptions: {
            ...clip.transcriptCaptions,
            style: {
              ...(clip.transcriptCaptions.style ?? {}),
              ...(patch as TimelineTranscriptCaptionStyle),
            },
            updatedAt: Date.now(),
          },
        } as Partial<TimelineItem>)
      }
    },
    [clips, updateItem],
  )

  const setCaptionsVisible = useCallback(
    (enabled: boolean) => {
      for (const clip of clips) {
        updateItem(clip.id, {
          transcriptCaptions: {
            ...clip.transcriptCaptions,
            enabled,
            updatedAt: Date.now(),
          },
        } as Partial<TimelineItem>)
      }
    },
    [clips, updateItem],
  )

  const updateCue = useCallback(
    (cueId: string, patch: Partial<{ text: string; startSeconds: number; endSeconds: number }>) => {
      const next = firstClip.transcriptCaptions.cues.map((cue) =>
        cue.id === cueId ? { ...cue, ...patch } : cue,
      )
      updateItem(firstClip.id, {
        transcriptCaptions: {
          ...firstClip.transcriptCaptions,
          cues: next,
          updatedAt: Date.now(),
        },
      } as Partial<TimelineItem>)
    },
    [firstClip, updateItem],
  )

  const seekToCue = useCallback(
    (startSeconds: number) => {
      const sourceFps = firstClip.sourceFps ?? fps
      const sourceStartSeconds = (firstClip.sourceStart ?? 0) / sourceFps
      const speed = firstClip.speed ?? 1
      const timelineSeconds = Math.max(0, (startSeconds - sourceStartSeconds) / speed)
      setCurrentFrame(Math.max(0, firstClip.from + Math.round(timelineSeconds * fps)))
    },
    [firstClip, fps, setCurrentFrame],
  )

  if (clips.length > 1) {
    return (
      <PropertySection
        title={i18n.t('editor.subtitleSection.title')}
        icon={Captions}
        defaultOpen={true}
      >
        <div className="space-y-3 px-1">
          <div className="flex items-center justify-between gap-3 rounded border border-border bg-muted/20 px-2 py-1.5">
            <Label htmlFor="virtual-transcript-captions-visible" className="text-xs font-medium">
              {i18n.t('editor.subtitleSection.showSubtitle')}
            </Label>
            <Switch
              id="virtual-transcript-captions-visible"
              checked={captionsVisible}
              onCheckedChange={setCaptionsVisible}
            />
          </div>

          <CaptionStyleControls
            items={styleItems}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            onApplyPatch={applyStylePatch}
          />

          <p className="text-xs text-muted-foreground">
            {i18n.t('editor.subtitleSection.multiSelectHint', {
              segments: clips.length,
              cues: totalCues,
            })}
          </p>
        </div>
      </PropertySection>
    )
  }

  return (
    <PropertySection
      title={i18n.t('editor.subtitleSection.title')}
      icon={Captions}
      defaultOpen={true}
    >
      <div className="space-y-3 px-1">
        <VirtualCueList
          cues={firstClip.transcriptCaptions.cues}
          onChange={updateCue}
          onSeek={seekToCue}
        />

        <p className="text-xs text-muted-foreground">
          {i18n.t('editor.subtitleSection.cueCount', {
            count: firstClip.transcriptCaptions.cues.length,
          })}{' '}
          - {i18n.t('editor.subtitleSection.transcript')}
        </p>

        <div className="flex items-center justify-between gap-3 rounded border border-border bg-muted/20 px-2 py-1.5">
          <Label htmlFor="virtual-transcript-captions-visible" className="text-xs font-medium">
            {i18n.t('editor.subtitleSection.showSubtitle')}
          </Label>
          <Switch
            id="virtual-transcript-captions-visible"
            checked={captionsVisible}
            onCheckedChange={setCaptionsVisible}
          />
        </div>

        <CaptionStyleControls
          items={styleItems}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          onApplyPatch={applyStylePatch}
        />
      </div>
    </PropertySection>
  )
})
