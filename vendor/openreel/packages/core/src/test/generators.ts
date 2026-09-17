import * as fc from "fast-check";
import type {
  Project,
  ProjectSettings,
  MediaItem,
  MediaMetadata,
  MediaLibrary,
  Timeline,
  Track,
  Clip,
  Effect,
  Transform,
  Keyframe,
  Marker,
  EasingType,
  Transition,
  Subtitle,
} from "../types";

// Constants for generation bounds
const MIN_DIMENSION = 320;
const MAX_DIMENSION = 7680; // 8K
const MIN_FRAME_RATE = 1;
const MAX_FRAME_RATE = 120;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 192000;
const MAX_DURATION = 86400; // 24 hours in seconds

export const idArb = fc
  .string({ minLength: 1, maxLength: 36 })
  .filter((s) => s.trim().length > 0);

export const nameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

export const timestampArb = fc.nat();

export const durationArb = fc.double({
  min: 0.001,
  max: MAX_DURATION,
  noNaN: true,
});

export const timePositionArb = fc.double({
  min: 0,
  max: MAX_DURATION,
  noNaN: true,
});

export const easingTypeArb: fc.Arbitrary<EasingType> = fc.constantFrom(
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "bezier",
);

export const projectSettingsArb: fc.Arbitrary<ProjectSettings> = fc.record({
  width: fc.integer({ min: MIN_DIMENSION, max: MAX_DIMENSION }),
  height: fc.integer({ min: MIN_DIMENSION, max: MAX_DIMENSION }),
  frameRate: fc.integer({ min: MIN_FRAME_RATE, max: MAX_FRAME_RATE }),
  sampleRate: fc.integer({ min: MIN_SAMPLE_RATE, max: MAX_SAMPLE_RATE }),
  channels: fc.integer({ min: 1, max: 8 }),
});

export const mediaMetadataArb: fc.Arbitrary<MediaMetadata> = fc.record({
  duration: durationArb,
  width: fc.integer({ min: MIN_DIMENSION, max: MAX_DIMENSION }),
  height: fc.integer({ min: MIN_DIMENSION, max: MAX_DIMENSION }),
  frameRate: fc.integer({ min: MIN_FRAME_RATE, max: MAX_FRAME_RATE }),
  codec: fc.constantFrom("h264", "h265", "vp9", "av1", "aac", "opus", "mp3"),
  sampleRate: fc.integer({ min: MIN_SAMPLE_RATE, max: MAX_SAMPLE_RATE }),
  channels: fc.integer({ min: 1, max: 8 }),
  fileSize: fc.integer({ min: 1024, max: 10 * 1024 * 1024 * 1024 }), // 1KB to 10GB
});

export const mediaItemArb: fc.Arbitrary<MediaItem> = fc.record({
  id: idArb,
  name: nameArb,
  type: fc.constantFrom("video", "audio", "image"),
  fileHandle: fc.constant(null), // FileSystemFileHandle is not serializable
  blob: fc.constant(null), // Blobs are not serializable
  metadata: mediaMetadataArb,
  thumbnailUrl: fc.option(fc.webUrl(), { nil: null }),
  waveformData: fc.constant(null), // Float32Array handled separately
});

export const mediaLibraryArb: fc.Arbitrary<MediaLibrary> = fc.record({
  items: fc.array(mediaItemArb, { maxLength: 50 }),
});

export const transformArb: fc.Arbitrary<Transform> = fc.record({
  position: fc.record({
    x: fc.double({ min: -10000, max: 10000, noNaN: true }),
    y: fc.double({ min: -10000, max: 10000, noNaN: true }),
  }),
  scale: fc.record({
    x: fc.double({ min: 0.01, max: 100, noNaN: true }),
    y: fc.double({ min: 0.01, max: 100, noNaN: true }),
  }),
  rotation: fc.double({ min: -360, max: 360, noNaN: true }),
  anchor: fc.record({
    x: fc.double({ min: 0, max: 1, noNaN: true }),
    y: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  opacity: fc.double({ min: 0, max: 1, noNaN: true }),
});

const jsonSafeValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.integer(),
);

export const effectArb: fc.Arbitrary<Effect> = fc.record({
  id: idArb,
  type: fc.constantFrom(
    "brightness",
    "contrast",
    "saturation",
    "blur",
    "sharpen",
  ),
  params: fc.dictionary(fc.string(), jsonSafeValueArb),
  enabled: fc.boolean(),
});

export const keyframeArb: fc.Arbitrary<Keyframe> = fc.record({
  id: idArb,
  time: timePositionArb,
  property: fc.constantFrom(
    "opacity",
    "x",
    "y",
    "scaleX",
    "scaleY",
    "rotation",
  ),
  value: fc.oneof(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.boolean(),
  ),
  easing: easingTypeArb,
});

export const clipArb: fc.Arbitrary<Clip> = fc.record({
  id: idArb,
  mediaId: idArb,
  trackId: idArb,
  startTime: timePositionArb,
  duration: durationArb,
  inPoint: timePositionArb,
  outPoint: durationArb,
  effects: fc.array(effectArb, { maxLength: 10 }),
  audioEffects: fc.array(effectArb, { maxLength: 5 }),
  transform: transformArb,
  volume: fc.double({ min: 0, max: 2, noNaN: true }),
  keyframes: fc.array(keyframeArb, { maxLength: 20 }),
});

export const markerArb: fc.Arbitrary<Marker> = fc.record({
  id: idArb,
  time: timePositionArb,
  label: nameArb,
  color: fc.hexaString({ minLength: 6, maxLength: 6 }).map((s) => `#${s}`),
});

export const transitionArb: fc.Arbitrary<Transition> = fc.record({
  id: idArb,
  clipAId: idArb,
  clipBId: idArb,
  type: fc.constantFrom(
    "crossfade",
    "dipToBlack",
    "dipToWhite",
    "wipe",
    "slide",
    "zoom",
    "push",
  ),
  duration: durationArb,
  params: fc.dictionary(fc.string(), jsonSafeValueArb),
});

const subtitleStyleArb = fc.record({
  fontFamily: fc.string(),
  fontSize: fc.integer({ min: 10, max: 100 }),
  color: fc.hexaString({ minLength: 6, maxLength: 6 }).map((s) => `#${s}`),
  backgroundColor: fc
    .hexaString({ minLength: 6, maxLength: 6 })
    .map((s) => `#${s}`),
  position: fc.constantFrom("top", "center", "bottom") as fc.Arbitrary<
    "top" | "center" | "bottom"
  >,
});

export const subtitleArb: fc.Arbitrary<Subtitle> = fc.record({
  id: idArb,
  text: fc.string(),
  startTime: timePositionArb,
  endTime: durationArb,
  style: subtitleStyleArb,
});

export const trackArb: fc.Arbitrary<Track> = fc.record({
  id: idArb,
  type: fc.constantFrom("video", "audio", "image"),
  name: nameArb,
  clips: fc.array(clipArb, { maxLength: 20 }),
  locked: fc.boolean(),
  hidden: fc.boolean(),
  muted: fc.boolean(),
  solo: fc.boolean(),
  transitions: fc.array(transitionArb, { maxLength: 10 }),
});

export const timelineArb: fc.Arbitrary<Timeline> = fc.record({
  tracks: fc.array(trackArb, { maxLength: 20 }),
  duration: durationArb,
  markers: fc.array(markerArb, { maxLength: 50 }),
  subtitles: fc.array(subtitleArb, { maxLength: 20 }),
});

export const projectArb: fc.Arbitrary<Project> = fc.record({
  id: idArb,
  name: nameArb,
  createdAt: timestampArb,
  modifiedAt: timestampArb,
  settings: projectSettingsArb,
  mediaLibrary: mediaLibraryArb,
  timeline: timelineArb,
});

export const actionArb: fc.Arbitrary<any> = fc.oneof(
  // Track actions
  fc.record({
    type: fc.constant("track/add"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      trackType: fc.constantFrom("video", "audio", "image"),
      position: fc.nat({ max: 10 }),
    }),
  }),
  fc.record({
    type: fc.constant("track/remove"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      trackId: idArb,
    }),
  }),
  fc.record({
    type: fc.constant("track/lock"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      trackId: idArb,
      locked: fc.boolean(),
    }),
  }),
  // Clip actions
  fc.record({
    type: fc.constant("clip/add"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      trackId: idArb,
      mediaId: idArb,
      startTime: timePositionArb,
    }),
  }),
  fc.record({
    type: fc.constant("clip/remove"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      clipId: idArb,
    }),
  }),
  fc.record({
    type: fc.constant("clip/move"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      clipId: idArb,
      startTime: timePositionArb,
      trackId: idArb,
    }),
  }),
  // Audio actions
  fc.record({
    type: fc.constant("audio/setVolume"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      clipId: idArb,
      volume: fc.double({ min: 0, max: 4, noNaN: true }),
    }),
  }),
  fc.record({
    type: fc.constant("transform/update"),
    id: idArb,
    timestamp: timestampArb,
    params: fc.record({
      clipId: idArb,
      transform: fc.record({
        position: fc.record({
          x: fc.double({ min: -10000, max: 10000, noNaN: true }),
          y: fc.double({ min: -10000, max: 10000, noNaN: true }),
        }),
        opacity: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
    }),
  }),
);

export const projectWithTracksArb: fc.Arbitrary<Project> = fc
  .record({
    id: idArb,
    name: nameArb,
    createdAt: timestampArb,
    modifiedAt: timestampArb,
    settings: projectSettingsArb,
    mediaLibrary: fc.record({
      items: fc.array(mediaItemArb, { minLength: 1, maxLength: 5 }),
    }),
    timeline: fc.record({
      tracks: fc.array(trackArb, { minLength: 1, maxLength: 5 }),
      duration: durationArb,
      markers: fc.array(markerArb, { maxLength: 10 }),
      subtitles: fc.array(subtitleArb, { maxLength: 20 }),
    }),
  })
  .map((project) => {
    if (project.timeline.tracks.length === 0) {
      return {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            {
              id: "track-1",
              type: "video" as const,
              name: "Video Track 1",
              clips: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
              transitions: [],
            },
          ],
        },
      };
    }
    return project;
  });

export const executableActionArb = (project: Project): fc.Arbitrary<any> => {
  const trackIds = project.timeline.tracks.map((t) => t.id);
  const mediaIds = project.mediaLibrary.items.map((m) => m.id);

  return fc.oneof(
    // Track add action (always valid)
    fc.record({
      type: fc.constant("track/add"),
      id: idArb,
      timestamp: timestampArb,
      params: fc.record({
        trackType: fc.constantFrom("video", "audio", "image"),
        position: fc.option(fc.nat({ max: trackIds.length }), {
          nil: undefined,
        }),
      }),
    }),
    // Clip add action (requires valid track and media)
    trackIds.length > 0 && mediaIds.length > 0
      ? fc.record({
          type: fc.constant("clip/add"),
          id: idArb,
          timestamp: timestampArb,
          params: fc.record({
            trackId: fc.constantFrom(...trackIds),
            mediaId: fc.constantFrom(...mediaIds),
            startTime: timePositionArb,
          }),
        })
      : fc.record({
          type: fc.constant("track/add"),
          id: idArb,
          timestamp: timestampArb,
          params: fc.record({
            trackType: fc.constantFrom("video", "audio", "image"),
          }),
        }),
  );
};
