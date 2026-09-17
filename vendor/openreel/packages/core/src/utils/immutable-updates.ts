import type {
  Timeline,
  Track,
  Clip,
  Effect,
  Keyframe,
  Transition,
} from "../types/timeline";

/**
 * Helper type that removes readonly modifiers from a type and its nested properties.
 * Useful for making deep copies mutable while preserving structure.
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends readonly (infer U)[]
    ? Mutable<U>[]
    : T[P] extends object
      ? Mutable<T[P]>
      : T[P];
};

export type MutableTimeline = Mutable<Timeline>;
export type MutableTrack = Mutable<Track>;
export type MutableClip = Mutable<Clip>;

/**
 * Updates a track in a timeline using an updater function.
 * Returns a new timeline with the updated track without mutating the original.
 *
 * @param timeline - Original timeline
 * @param trackId - ID of track to update
 * @param updater - Function that takes a track and returns updated track
 * @returns New timeline with updated track
 */
export function updateTrackInTimeline(
  timeline: Timeline,
  trackId: string,
  updater: (track: Track) => Track,
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId ? updater(track) : track,
    ),
  };
}

/**
 * Updates a single property of a track in a timeline.
 *
 * @param timeline - Original timeline
 * @param trackId - ID of track to update
 * @param key - Property key to update
 * @param value - New value for the property
 * @returns New timeline with updated property
 */
export function updateTrackProperty<K extends keyof Track>(
  timeline: Timeline,
  trackId: string,
  key: K,
  value: Track[K],
): Timeline {
  return updateTrackInTimeline(timeline, trackId, (track) => ({
    ...track,
    [key]: value,
  }));
}

/**
 * Updates a clip in a timeline using an updater function.
 * Finds the clip across all tracks and updates it.
 *
 * @param timeline - Original timeline
 * @param clipId - ID of clip to update
 * @param updater - Function that takes a clip and returns updated clip
 * @returns New timeline with updated clip
 */
export function updateClipInTimeline(
  timeline: Timeline,
  clipId: string,
  updater: (clip: Clip) => Clip,
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clip.id === clipId ? updater(clip) : clip,
      ),
    })),
  };
}

/**
 * Updates a clip within a specific track.
 *
 * @param track - Track containing the clip
 * @param clipId - ID of clip to update
 * @param updater - Function that takes a clip and returns updated clip
 * @returns New track with updated clip
 */
export function updateClipInTrack(
  track: Track,
  clipId: string,
  updater: (clip: Clip) => Clip,
): Track {
  return {
    ...track,
    clips: track.clips.map((clip) =>
      clip.id === clipId ? updater(clip) : clip,
    ),
  };
}

export function updateClipProperty<K extends keyof Clip>(
  timeline: Timeline,
  clipId: string,
  key: K,
  value: Clip[K],
): Timeline {
  return updateClipInTimeline(timeline, clipId, (clip) => ({
    ...clip,
    [key]: value,
  }));
}

/**
 * Adds a clip to a track and maintains sorted order by startTime.
 *
 * @param timeline - Original timeline
 * @param trackId - ID of track to add clip to
 * @param clip - Clip to add
 * @returns New timeline with clip added and sorted
 */
export function addClipToTrack(
  timeline: Timeline,
  trackId: string,
  clip: Clip,
): Timeline {
  return updateTrackInTimeline(timeline, trackId, (track) => ({
    ...track,
    clips: [...track.clips, clip].sort((a, b) => a.startTime - b.startTime),
  }));
}

/**
 * Removes a clip from a timeline (searches all tracks).
 *
 * @param timeline - Original timeline
 * @param clipId - ID of clip to remove
 * @returns New timeline with clip removed
 */
export function removeClipFromTimeline(
  timeline: Timeline,
  clipId: string,
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== clipId),
    })),
  };
}

export function addTrackToTimeline(timeline: Timeline, track: Track): Timeline {
  return {
    ...timeline,
    tracks: [...timeline.tracks, track],
  };
}

export function removeTrackFromTimeline(
  timeline: Timeline,
  trackId: string,
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.filter((track) => track.id !== trackId),
  };
}

export function addEffectToClip(
  timeline: Timeline,
  clipId: string,
  effect: Effect,
): Timeline {
  return updateClipInTimeline(timeline, clipId, (clip) => ({
    ...clip,
    effects: [...clip.effects, effect],
  }));
}

export function removeEffectFromClip(
  timeline: Timeline,
  clipId: string,
  effectId: string,
): Timeline {
  return updateClipInTimeline(timeline, clipId, (clip) => ({
    ...clip,
    effects: clip.effects.filter((effect) => effect.id !== effectId),
  }));
}

export function updateEffectInClip(
  timeline: Timeline,
  clipId: string,
  effectId: string,
  updater: (effect: Effect) => Effect,
): Timeline {
  return updateClipInTimeline(timeline, clipId, (clip) => ({
    ...clip,
    effects: clip.effects.map((effect) =>
      effect.id === effectId ? updater(effect) : effect,
    ),
  }));
}

export function addKeyframeToClip(
  timeline: Timeline,
  clipId: string,
  keyframe: Keyframe,
): Timeline {
  return updateClipInTimeline(timeline, clipId, (clip) => {
    const existingIndex = clip.keyframes.findIndex(
      (kf) => kf.time === keyframe.time && kf.property === keyframe.property,
    );

    if (existingIndex >= 0) {
      const newKeyframes = [...clip.keyframes];
      newKeyframes[existingIndex] = keyframe;
      return { ...clip, keyframes: newKeyframes };
    }

    return {
      ...clip,
      keyframes: [...clip.keyframes, keyframe].sort((a, b) => a.time - b.time),
    };
  });
}

export function removeKeyframeFromClip(
  timeline: Timeline,
  clipId: string,
  keyframeId: string,
): Timeline {
  return updateClipInTimeline(timeline, clipId, (clip) => ({
    ...clip,
    keyframes: clip.keyframes.filter((kf) => kf.id !== keyframeId),
  }));
}

export function addTransitionToTrack(
  timeline: Timeline,
  trackId: string,
  transition: Transition,
): Timeline {
  return updateTrackInTimeline(timeline, trackId, (track) => ({
    ...track,
    transitions: [...track.transitions, transition],
  }));
}

export function removeTransitionFromTrack(
  timeline: Timeline,
  trackId: string,
  transitionId: string,
): Timeline {
  return updateTrackInTimeline(timeline, trackId, (track) => ({
    ...track,
    transitions: track.transitions.filter((t) => t.id !== transitionId),
  }));
}

/**
 * Finds a track by its ID.
 *
 * @param timeline - Timeline to search in
 * @param trackId - ID of track to find
 * @returns Track if found, undefined otherwise
 */
export function findTrackById(
  timeline: Timeline,
  trackId: string,
): Track | undefined {
  return timeline.tracks.find((track) => track.id === trackId);
}

/**
 * Finds a clip by its ID (searches all tracks).
 *
 * @param timeline - Timeline to search in
 * @param clipId - ID of clip to find
 * @returns Clip if found, undefined otherwise
 */
export function findClipById(
  timeline: Timeline,
  clipId: string,
): Clip | undefined {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/**
 * Finds the track containing a specific clip.
 *
 * @param timeline - Timeline to search in
 * @param clipId - ID of clip to find track for
 * @returns Track containing the clip, or undefined if not found
 */
export function findTrackByClipId(
  timeline: Timeline,
  clipId: string,
): Track | undefined {
  return timeline.tracks.find((track) =>
    track.clips.some((clip) => clip.id === clipId),
  );
}

/**
 * Moves a clip from its current track to a different track.
 *
 * @param timeline - Original timeline
 * @param clipId - ID of clip to move
 * @param targetTrackId - ID of destination track
 * @returns New timeline with clip moved
 */
export function moveClipToTrack(
  timeline: Timeline,
  clipId: string,
  targetTrackId: string,
): Timeline {
  const clip = findClipById(timeline, clipId);
  if (!clip) return timeline;

  const withoutClip = removeClipFromTimeline(timeline, clipId);
  const movedClip: Clip = { ...clip, trackId: targetTrackId };
  return addClipToTrack(withoutClip, targetTrackId, movedClip);
}

export function reorderTracks(
  timeline: Timeline,
  fromIndex: number,
  toIndex: number,
): Timeline {
  const tracks = [...timeline.tracks];
  const [removed] = tracks.splice(fromIndex, 1);
  tracks.splice(toIndex, 0, removed);
  return { ...timeline, tracks };
}

export function duplicateClip(
  timeline: Timeline,
  clipId: string,
  newId: string,
  newStartTime?: number,
): Timeline {
  const clip = findClipById(timeline, clipId);
  if (!clip) return timeline;

  const duplicated: Clip = {
    ...clip,
    id: newId,
    startTime: newStartTime ?? clip.startTime + clip.duration,
  };

  return addClipToTrack(timeline, clip.trackId, duplicated);
}
