import type {
  Clip,
  MediaItem,
  Project,
  Track,
} from "../types";
import type { TextClip } from "../text/types";
import type { ShapeClip, StickerClip, SVGClip } from "../graphics/types";
import type { AdjustmentLayer } from "../video/adjustment-layer-engine";
import type { MotionCompositionInstance } from "../motion/types";

export const UNIVERSAL_TRACKS_CAPABILITY = "universal-tracks-v1";
export const UNIVERSAL_TRACKS_MIN_READER_VERSION = "1.2.0";

export type TimelineItemKind =
  | "media"
  | "text"
  | "shape"
  | "svg"
  | "sticker"
  | "adjustment"
  | "motion";

interface TimelineItemBase<TKind extends TimelineItemKind, TItem> {
  readonly id: string;
  readonly trackId: string;
  readonly kind: TKind;
  readonly startTime: number;
  readonly duration: number;
  readonly item: TItem;
}

export type ResolvedTimelineItem =
  | (TimelineItemBase<"media", Clip> & { readonly mediaItem?: MediaItem })
  | TimelineItemBase<"text", TextClip>
  | TimelineItemBase<"shape", ShapeClip>
  | TimelineItemBase<"svg", SVGClip>
  | TimelineItemBase<"sticker", StickerClip>
  | TimelineItemBase<"adjustment", AdjustmentLayer>
  | TimelineItemBase<"motion", MotionCompositionInstance>;

export interface TimelineItemCapabilities {
  readonly visual: boolean;
  readonly audio: boolean;
  readonly transformable: boolean;
  readonly trimSource: boolean;
  readonly transitionSource: boolean;
  readonly textEditable: boolean;
  readonly graphicEditable: boolean;
}

export interface TimelineTrackRenderEntry {
  readonly track: Track;
  readonly originalIndex: number;
}

/** Text, graphics, and captions are foreground layers regardless of creation order. */
export function isOverlayTrack(
  track: { readonly type: string; readonly role?: string },
): boolean {
  return track.type === "text" || track.type === "graphics" || track.role === "captions";
}

/**
 * Returns visible tracks in canvas painter order. The timeline stores the
 * front-most track at index 0, so rendering must walk from the last visible
 * track to the first. Overlay tracks are treated as foreground layers even
 * in legacy projects that were saved with them below media tracks.
 */
export function getVisibleTrackRenderOrder(
  tracks: readonly Track[],
  foregroundTrackIds?: ReadonlySet<string>,
): TimelineTrackRenderEntry[] {
  return tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(({ track }) => !track.hidden)
    .sort((left, right) => {
      const leftIsOverlay = isOverlayTrack(left.track)
        || foregroundTrackIds?.has(left.track.id) === true;
      const rightIsOverlay = isOverlayTrack(right.track)
        || foregroundTrackIds?.has(right.track.id) === true;
      if (leftIsOverlay !== rightIsOverlay) {
        return leftIsOverlay ? -1 : 1;
      }
      return left.originalIndex - right.originalIndex;
    })
    .reverse();
}

const VISUAL_ONLY_CAPABILITIES: TimelineItemCapabilities = {
  visual: true,
  audio: false,
  transformable: true,
  trimSource: false,
  transitionSource: false,
  textEditable: false,
  graphicEditable: false,
};

function mediaHasVideo(mediaItem: MediaItem | undefined): boolean {
  if (!mediaItem) return false;
  // Static images are visual timeline items even though importers correctly
  // describe them as having no encoded video stream.
  if (mediaItem.type === "image") return true;
  if (typeof mediaItem.metadata.hasVideo === "boolean") {
    return mediaItem.metadata.hasVideo;
  }
  return mediaItem.type === "video";
}

function mediaHasAudio(mediaItem: MediaItem | undefined): boolean {
  if (!mediaItem) return false;
  if (typeof mediaItem.metadata.hasAudio === "boolean") {
    return mediaItem.metadata.hasAudio;
  }
  if (mediaItem.type === "audio") return true;
  if (mediaItem.type !== "video") return false;
  return mediaItem.metadata.channels > 0 || mediaItem.metadata.sampleRate > 0;
}

export function getMediaItemCapabilities(
  mediaItem: MediaItem | undefined,
): Pick<TimelineItemCapabilities, "visual" | "audio"> {
  return {
    visual: mediaHasVideo(mediaItem),
    audio: mediaHasAudio(mediaItem),
  };
}

function mediaItemRef(
  project: Project,
  trackId: string,
  clip: Clip,
): ResolvedTimelineItem {
  return {
    id: clip.id,
    trackId,
    kind: "media",
    startTime: clip.startTime,
    duration: clip.duration,
    item: clip,
    mediaItem: project.mediaLibrary.items.find(
      (candidate) => candidate.id === clip.mediaId,
    ),
  };
}

export function getTimelineItems(project: Project): ResolvedTimelineItem[] {
  const items: ResolvedTimelineItem[] = [];

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      items.push(mediaItemRef(project, track.id, clip));
    }
  }

  for (const clip of project.textClips ?? []) {
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "text",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const clip of project.shapeClips ?? []) {
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "shape",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const clip of project.svgClips ?? []) {
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "svg",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const clip of project.stickerClips ?? []) {
    items.push({
      id: clip.id,
      trackId: clip.trackId,
      kind: "sticker",
      startTime: clip.startTime,
      duration: clip.duration,
      item: clip,
    });
  }

  for (const layer of project.adjustmentLayers ?? []) {
    items.push({
      id: layer.id,
      trackId: layer.trackId,
      kind: "adjustment",
      startTime: layer.startTime,
      duration: layer.duration,
      item: layer,
    });
  }

  for (const instance of project.motionInstances ?? []) {
    if (!instance.trackId) continue;
    items.push({
      id: instance.id,
      trackId: instance.trackId,
      kind: "motion",
      startTime: instance.startTime,
      duration: instance.duration,
      item: instance,
    });
  }

  return items.sort(
    (left, right) =>
      left.startTime - right.startTime || left.id.localeCompare(right.id),
  );
}

export function getTrackItems(
  project: Project,
  trackId: string,
): ResolvedTimelineItem[] {
  return getTimelineItems(project).filter((item) => item.trackId === trackId);
}

export function resolveTimelineItem(
  project: Project,
  itemId: string,
): ResolvedTimelineItem | null {
  return getTimelineItems(project).find((item) => item.id === itemId) ?? null;
}

export function getTimelineItemCapabilities(
  item: ResolvedTimelineItem,
): TimelineItemCapabilities {
  if (item.kind === "media") {
    const { visual, audio } = getMediaItemCapabilities(item.mediaItem);
    return {
      visual,
      audio,
      transformable: visual,
      trimSource: true,
      transitionSource:
        visual &&
        (item.mediaItem?.type === "video" || item.mediaItem?.type === "image"),
      textEditable: false,
      graphicEditable: false,
    };
  }

  if (item.kind === "text") {
    return { ...VISUAL_ONLY_CAPABILITIES, textEditable: true };
  }
  if (
    item.kind === "shape" ||
    item.kind === "svg" ||
    item.kind === "sticker"
  ) {
    return { ...VISUAL_ONLY_CAPABILITIES, graphicEditable: true };
  }
  if (item.kind === "motion") {
    return { ...VISUAL_ONLY_CAPABILITIES, trimSource: true };
  }
  return {
    ...VISUAL_ONLY_CAPABILITIES,
    transformable: false,
    trimSource: true,
  };
}

export function trackHasVisualItems(project: Project, trackId: string): boolean {
  return getTrackItems(project, trackId).some(
    (item) => getTimelineItemCapabilities(item).visual,
  );
}

export function trackHasAudioItems(project: Project, trackId: string): boolean {
  return getTrackItems(project, trackId).some(
    (item) => getTimelineItemCapabilities(item).audio,
  );
}

export function isStandardTrack(_track: Track): boolean {
  return true;
}

export function projectUsesUniversalTracks(project: Project): boolean {
  return (project.capabilities ?? []).includes(UNIVERSAL_TRACKS_CAPABILITY);
}

export function withUniversalTracksCapability(project: Project): Project {
  if (projectUsesUniversalTracks(project)) return project;
  return {
    ...project,
    capabilities: [
      ...(project.capabilities ?? []),
      UNIVERSAL_TRACKS_CAPABILITY,
    ],
    minimumReaderVersion: UNIVERSAL_TRACKS_MIN_READER_VERSION,
  };
}
