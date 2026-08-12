import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MediaMetadata } from '@freecut/types/storage'
import {
  useMarqueeSelection,
  type MarqueeItem,
  type ResolvedMarqueeItem,
} from '@freecut/shared/marquee/use-marquee-selection'

interface UseMediaLibraryMarqueeParams {
  compositions: ReadonlyArray<{ id: string }>
  filteredMediaItems: MediaMetadata[]
  selectedMediaIds: string[]
  selectedCompositionIds: string[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  setSelection: (selection: { mediaIds: string[]; compositionIds: string[] }) => void
}

/**
 * Marquee (drag-rectangle) selection for the media library grid, including the
 * live preview highlight applied directly to media/composition card DOM nodes
 * (bypassing React for throttled per-frame updates). Commits the final selection
 * to the media-library store. Extracted verbatim from `MediaLibrary`.
 */
export function useMediaLibraryMarquee({
  compositions,
  filteredMediaItems,
  selectedMediaIds,
  selectedCompositionIds,
  scrollContainerRef,
  setSelection,
}: UseMediaLibraryMarqueeParams) {
  const previewAssetIdsRef = useRef<string[]>([])
  const assetElementsRef = useRef<Map<string, HTMLElement>>(new Map())

  const setPreviewAssetIds = useCallback(
    (ids: string[]) => {
      const container = scrollContainerRef.current
      if (!container) {
        previewAssetIdsRef.current = ids
        return
      }

      const nextIds = new Set(ids)
      for (const previousId of previewAssetIdsRef.current) {
        if (nextIds.has(previousId)) {
          continue
        }

        const element = assetElementsRef.current.get(previousId)
        element?.classList.remove(
          previousId.startsWith('media:')
            ? 'media-marquee-preview'
            : 'composition-marquee-preview',
        )
      }

      const previousIds = new Set(previewAssetIdsRef.current)
      for (const id of ids) {
        if (previousIds.has(id)) {
          continue
        }

        const element = assetElementsRef.current.get(id)
        element?.classList.add(
          id.startsWith('media:') ? 'media-marquee-preview' : 'composition-marquee-preview',
        )
      }

      previewAssetIdsRef.current = ids
    },
    [scrollContainerRef],
  )

  useEffect(() => {
    return () => {
      setPreviewAssetIds([])
    }
  }, [setPreviewAssetIds])

  const marqueeItems: MarqueeItem[] = useMemo(
    () => [
      ...compositions.map((composition) => ({
        id: `composition:${composition.id}`,
        getBoundingRect: () => null,
      })),
      ...filteredMediaItems.map((media) => ({
        id: `media:${media.id}`,
        getBoundingRect: () => null,
      })),
    ],
    [compositions, filteredMediaItems],
  )

  const resolveItems = useCallback((): ResolvedMarqueeItem[] => {
    const container = scrollContainerRef.current
    if (!container) return []

    const elements = new Map<string, HTMLElement>()
    const resolvedItems: ResolvedMarqueeItem[] = []

    for (const element of container.querySelectorAll<HTMLElement>(
      '[data-media-id], [data-composition-id]',
    )) {
      const mediaId = element.dataset.mediaId
      const compositionId = element.dataset.compositionId
      if (!mediaId && !compositionId) continue

      const id = mediaId ? `media:${mediaId}` : `composition:${compositionId}`
      const rect = element.getBoundingClientRect()
      elements.set(id, element)
      resolvedItems.push({
        id,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      })
    }

    assetElementsRef.current = elements
    return resolvedItems
  }, [scrollContainerRef])
  const committedSelectionIds = useMemo(
    () => [
      ...selectedCompositionIds.map((id) => `composition:${id}`),
      ...selectedMediaIds.map((id) => `media:${id}`),
    ],
    [selectedCompositionIds, selectedMediaIds],
  )

  const { marquee } = useMarqueeSelection({
    containerRef: scrollContainerRef as React.RefObject<HTMLElement>,
    items: marqueeItems,
    resolveItems,
    enabled: marqueeItems.length > 0,
    onPreviewSelectionChange: setPreviewAssetIds,
    committedSelectionIds,
    commitSelectionOnMouseUp: true,
    onSelectionChange: (ids) => {
      const nextMediaIds: string[] = []
      const nextCompositionIds: string[] = []

      for (const id of ids) {
        if (id.startsWith('media:')) {
          nextMediaIds.push(id.slice('media:'.length))
        } else if (id.startsWith('composition:')) {
          nextCompositionIds.push(id.slice('composition:'.length))
        }
      }

      setSelection({ mediaIds: nextMediaIds, compositionIds: nextCompositionIds })
    },
  })

  return { marquee }
}
