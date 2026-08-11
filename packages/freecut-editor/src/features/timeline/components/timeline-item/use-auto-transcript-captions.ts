import { useEffect, useRef } from 'react'
import type { TimelineItem as TimelineItemType } from '@freecut/types/timeline'
import { mediaTranscriptionService } from '../../deps/media-transcription-service'
import type { CaptionDialogState } from './use-caption-dialog-state'

interface UseAutoTranscriptCaptionsParams {
  item: TimelineItemType
  caption: CaptionDialogState
  hasTimelineCaptions: boolean
  isBroken: boolean
}

export function shouldAutoInsertTranscriptCaptions({
  item,
  caption,
  hasTimelineCaptions,
  isBroken,
}: UseAutoTranscriptCaptionsParams): boolean {
  return (
    !item.aiEditingSource &&
    caption.canManageCaptions &&
    caption.mediaHasTranscript &&
    !hasTimelineCaptions &&
    !(item.transcriptCaptions?.type === 'transcript' && item.transcriptCaptions.enabled === false) &&
    !isBroken &&
    (item.type === 'video' || item.type === 'audio') &&
    Boolean(item.mediaId)
  )
}

/**
 * Auto-enables transcript-backed captions for a video/audio clip the first time
 * its media has a transcript and no captions yet. Runs once per item+media pair
 * (tracked by a ref) and stays silent on failure — the explicit "Generate
 * Captions" action remains the user-facing fallback.
 */
export function useAutoTranscriptCaptions({
  item,
  caption,
  hasTimelineCaptions,
  isBroken,
}: UseAutoTranscriptCaptionsParams): void {
  const attemptRef = useRef<string | null>(null)
  const mediaId = item.mediaId
  const eligible = shouldAutoInsertTranscriptCaptions({
    item,
    caption,
    hasTimelineCaptions,
    isBroken,
  })

  useEffect(() => {
    if (!eligible || !mediaId) return

    const attemptKey = `${item.id}:${mediaId}`
    if (attemptRef.current === attemptKey) {
      return
    }
    attemptRef.current = attemptKey

    void mediaTranscriptionService
      .insertTranscriptAsCaptions(mediaId, {
        clipIds: [item.id],
        replaceExisting: false,
        selectUpdatedClips: false,
      })
      .catch(() => {
        // Keep this silent: the explicit Generate Captions action remains the user-facing fallback.
      })
  }, [eligible, item.id, mediaId])
}
