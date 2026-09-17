import type { Project } from "@openreel/core/types/project";
import { isOverlayTrack } from "@openreel/core";

/**
 * Compact, token-efficient, blob-free views of the project for the agent's read
 * tools. All times are seconds (float).
 */

export interface EditorStateView {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly settings: {
      readonly width: number;
      readonly height: number;
      readonly fps: number;
    };
  };
  readonly durationSec: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly mediaCount: number;
  readonly overlayCount: number;
  readonly creation?: {
    readonly version: string;
    readonly assetCount: number;
    readonly sceneCount: number;
    readonly activeSceneId?: string;
    readonly operationCount: number;
  };
}

export interface MediaView {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly durationSec?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface TrackView {
  readonly index: number;
  readonly id: string;
  readonly type: string;
  readonly layer: "overlay" | "media";
  readonly mode?: "standard";
  readonly role?: string;
  readonly name: string;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly clipCount: number;
}

export interface ClipView {
  readonly id: string;
  readonly trackIndex: number;
  readonly trackType: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly durationSec: number;
  readonly mediaId?: string;
  readonly speed: number;
  readonly hasEffects: boolean;
  readonly hasColorGrading: boolean;
}

export interface OverlayView {
  readonly id: string;
  readonly kind: "text" | "shape" | "svg" | "sticker";
  readonly trackId: string;
  readonly trackIndex: number;
  readonly trackType: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly durationSec: number;
  readonly hasEffects: boolean;
  readonly text?: string;
  readonly shapeType?: string;
  readonly animation?: string;
  readonly behindSubject?: boolean;
}

export interface TransitionView {
  readonly id: string;
  readonly trackId: string;
  readonly trackIndex: number;
  readonly clipAId: string;
  readonly clipBId?: string;
  readonly edge?: string;
  readonly type: string;
  readonly durationSec: number;
}

export interface ClipFilter {
  readonly trackIndex?: number;
  readonly fromSec?: number;
  readonly toSec?: number;
  /** Pagination for huge timelines: skip `offset`, return at most `limit`. */
  readonly offset?: number;
  readonly limit?: number;
}

interface RawClip {
  id: string;
  mediaId?: string;
  startTime: number;
  duration: number;
  speed?: number;
  effects?: unknown[];
  colorGrading?: unknown;
}

interface RawTrack {
  id: string;
  type: string;
  mode?: "standard";
  role?: string;
  name: string;
  locked?: boolean;
  hidden?: boolean;
  muted?: boolean;
  solo?: boolean;
  clips: RawClip[];
  transitions?: RawTransition[];
}

interface RawTransition {
  id: string;
  clipAId: string;
  clipBId?: string;
  edge?: string;
  type: string;
  duration: number;
}

interface RawOverlay {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  text?: string;
  shapeType?: string;
  animation?: { preset?: string };
  behindSubject?: boolean;
  effects?: unknown[];
}

function tracks(project: Project): RawTrack[] {
  return project.timeline.tracks as unknown as RawTrack[];
}

function overlayCount(project: Project): number {
  const p = project as unknown as Record<string, unknown[] | undefined>;
  return (
    (p.textClips?.length ?? 0) +
    (p.shapeClips?.length ?? 0) +
    (p.svgClips?.length ?? 0) +
    (p.stickerClips?.length ?? 0)
  );
}

export function serializeEditorState(project: Project): EditorStateView {
  const ts = tracks(project);
  const creation = project.creation;
  return {
    project: {
      id: project.id,
      name: project.name,
      settings: {
        width: project.settings.width,
        height: project.settings.height,
        fps: project.settings.frameRate,
      },
    },
    durationSec: project.timeline.duration,
    trackCount: ts.length,
    clipCount: ts.reduce((sum, t) => sum + t.clips.length, 0),
    mediaCount: project.mediaLibrary.items.length,
    overlayCount: overlayCount(project),
    creation: creation
      ? {
          version: creation.version,
          assetCount: creation.assets.length,
          sceneCount: creation.scenes.length,
          activeSceneId: creation.activeSceneId,
          operationCount: creation.operationHistory.length,
        }
      : undefined,
  };
}

export function listMedia(project: Project): MediaView[] {
  return project.mediaLibrary.items.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    durationSec: item.metadata?.duration,
    width: item.metadata?.width,
    height: item.metadata?.height,
  }));
}

export function listTracks(project: Project): TrackView[] {
  return tracks(project).map((t, index) => ({
    index,
    id: t.id,
    type: t.type,
    layer: isOverlayTrack(t) ? "overlay" : "media",
    ...(t.mode ? { mode: t.mode } : {}),
    ...(t.role ? { role: t.role } : {}),
    name: t.name,
    locked: t.locked ?? false,
    hidden: t.hidden ?? false,
    muted: t.muted ?? false,
    solo: t.solo ?? false,
    clipCount: t.clips.length,
  }));
}

function overlayArray(project: Project, key: string): readonly RawOverlay[] {
  const value = (project as unknown as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RawOverlay => item !== null && typeof item === "object",
  );
}

export function listOverlays(project: Project): OverlayView[] {
  const ts = tracks(project);
  const definitions: ReadonlyArray<readonly [OverlayView["kind"], string]> = [
    ["text", "textClips"],
    ["shape", "shapeClips"],
    ["svg", "svgClips"],
    ["sticker", "stickerClips"],
  ];
  const overlays: OverlayView[] = [];

  for (const [kind, key] of definitions) {
    for (const clip of overlayArray(project, key)) {
      const trackIndex = ts.findIndex((track) => track.id === clip.trackId);
      const startSec = Number.isFinite(clip.startTime) ? clip.startTime : 0;
      const durationSec = Number.isFinite(clip.duration) ? clip.duration : 0;
      overlays.push({
        id: clip.id,
        kind,
        trackId: clip.trackId,
        trackIndex,
        trackType: ts[trackIndex]?.type ?? "unknown",
        startSec,
        endSec: startSec + durationSec,
        durationSec,
        hasEffects: Array.isArray(clip.effects) && clip.effects.length > 0,
        ...(typeof clip.text === "string" ? { text: clip.text } : {}),
        ...(typeof clip.shapeType === "string" ? { shapeType: clip.shapeType } : {}),
        ...(typeof clip.animation?.preset === "string"
          ? { animation: clip.animation.preset }
          : {}),
        ...(typeof clip.behindSubject === "boolean"
          ? { behindSubject: clip.behindSubject }
          : {}),
      });
    }
  }

  return overlays.sort(
    (left, right) => left.startSec - right.startSec
      || left.trackIndex - right.trackIndex
      || left.id.localeCompare(right.id),
  );
}

export function listTransitions(project: Project): TransitionView[] {
  return tracks(project).flatMap((track, trackIndex) =>
    (track.transitions ?? []).map((transition) => ({
      id: transition.id,
      trackId: track.id,
      trackIndex,
      clipAId: transition.clipAId,
      ...(transition.clipBId ? { clipBId: transition.clipBId } : {}),
      ...(transition.edge ? { edge: transition.edge } : {}),
      type: transition.type,
      durationSec: transition.duration,
    })),
  );
}

export function listClips(project: Project, filter: ClipFilter = {}): ClipView[] {
  const result: ClipView[] = [];
  const ts = tracks(project);
  for (let trackIndex = 0; trackIndex < ts.length; trackIndex++) {
    if (filter.trackIndex !== undefined && filter.trackIndex !== trackIndex) {
      continue;
    }
    const track = ts[trackIndex];
    for (const clip of track.clips) {
      const startSec = clip.startTime;
      const endSec = clip.startTime + clip.duration;
      if (filter.fromSec !== undefined && endSec < filter.fromSec) continue;
      if (filter.toSec !== undefined && startSec > filter.toSec) continue;
      result.push({
        id: clip.id,
        trackIndex,
        trackType: track.type,
        startSec,
        endSec,
        durationSec: clip.duration,
        mediaId: clip.mediaId,
        speed: clip.speed ?? 1,
        hasEffects: (clip.effects?.length ?? 0) > 0,
        hasColorGrading: clip.colorGrading != null,
      });
    }
  }
  if (filter.offset !== undefined || filter.limit !== undefined) {
    const start = Math.max(0, filter.offset ?? 0);
    const end = filter.limit !== undefined ? start + Math.max(0, filter.limit) : undefined;
    return result.slice(start, end);
  }
  return result;
}

export function getClipDetail(
  project: Project,
  clipId: string,
): Record<string, unknown> | undefined {
  const ts = tracks(project);
  for (let trackIndex = 0; trackIndex < ts.length; trackIndex++) {
    const clip = ts[trackIndex].clips.find((c) => c.id === clipId);
    if (clip) {
      return { ...clip, trackIndex, trackType: ts[trackIndex].type };
    }
  }
  return undefined;
}

/** Resolve a clip by id, 0-based index, or `atSec`+trackIndex to its id. */
export function resolveClipId(
  project: Project,
  ref: { id?: string; index?: number; atSec?: number; trackIndex?: number },
): string | undefined {
  const ts = tracks(project);
  if (ref.id) {
    for (const t of ts) if (t.clips.some((c) => c.id === ref.id)) return ref.id;
    return undefined;
  }
  if (ref.trackIndex !== undefined && ref.index !== undefined) {
    return ts[ref.trackIndex]?.clips[ref.index]?.id;
  }
  if (ref.index !== undefined) {
    const flat = ts.flatMap((t) => t.clips);
    return flat[ref.index]?.id;
  }
  if (ref.atSec !== undefined) {
    const candidates = ts
      .filter((_, i) => ref.trackIndex === undefined || i === ref.trackIndex)
      .flatMap((t) => t.clips)
      .filter(
        (c) => ref.atSec! >= c.startTime && ref.atSec! < c.startTime + c.duration,
      );
    return candidates[0]?.id;
  }
  return undefined;
}
