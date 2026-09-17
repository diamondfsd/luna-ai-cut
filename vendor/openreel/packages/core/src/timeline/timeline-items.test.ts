import { describe, expect, it } from "vitest";
import type { Clip, MediaItem, Project, Track } from "../types";
import type { TextClip } from "../text/types";
import {
  UNIVERSAL_TRACKS_CAPABILITY,
  getMediaItemCapabilities,
  getTimelineItemCapabilities,
  getTimelineItems,
  getTrackItems,
  getVisibleTrackRenderOrder,
  isOverlayTrack,
  trackHasAudioItems,
  trackHasVisualItems,
  withUniversalTracksCapability,
} from "./timeline-items";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const clip = (id: string, mediaId: string, trackId = "mixed"): Clip => ({
  id,
  mediaId,
  trackId,
  startTime: id === "audio-clip" ? 2 : 0,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});

const track: Track = {
  id: "mixed",
  type: "text",
  name: "Legacy Text 1",
  clips: [clip("video-clip", "video"), clip("audio-clip", "audio")],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
};

const media = (
  id: string,
  type: MediaItem["type"],
  hasVideo: boolean,
  hasAudio: boolean,
): MediaItem => ({
  id,
  name: id,
  type,
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: {
    duration: 2,
    width: hasVideo ? 1920 : 0,
    height: hasVideo ? 1080 : 0,
    frameRate: hasVideo ? 30 : 0,
    codec: "test",
    sampleRate: hasAudio ? 48000 : 0,
    channels: hasAudio ? 2 : 0,
    fileSize: 1,
    hasVideo,
    hasAudio,
  },
});

const textClip: TextClip = {
  id: "text-clip",
  trackId: "mixed",
  startTime: 4,
  duration: 2,
  text: "Mixed",
  style: {
    fontFamily: "Inter",
    fontSize: 24,
    fontWeight: 400,
    fontStyle: "normal",
    color: "#fff",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
  },
  transform,
  keyframes: [],
};

const project: Project = {
  id: "project",
  name: "Mixed",
  createdAt: 1,
  modifiedAt: 1,
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: {
    items: [
      media("video", "video", true, true),
      media("audio", "audio", false, true),
    ],
  },
  timeline: { tracks: [track], subtitles: [], duration: 6, markers: [] },
  textClips: [textClip],
};

describe("universal timeline item model", () => {
  it("keeps imported still images visual when stream metadata hasVideo is false", () => {
    const importedImage = media("image", "image", false, false);
    const mixedTrackProject: Project = {
      ...project,
      mediaLibrary: {
        items: [...project.mediaLibrary.items, importedImage],
      },
      timeline: {
        ...project.timeline,
        tracks: [
          {
            ...track,
            clips: [
              clip("video-clip", "video"),
              {
                ...clip("image-clip", "image"),
                startTime: 2,
              },
            ],
          },
        ],
      },
    };

    expect(getMediaItemCapabilities(importedImage)).toEqual({
      visual: true,
      audio: false,
    });
    expect(
      getTimelineItemCapabilities(
        getTrackItems(mixedTrackProject, "mixed").find(
          (item) => item.id === "image-clip",
        )!,
      ),
    ).toMatchObject({ visual: true, audio: false });
    expect(trackHasVisualItems(mixedTrackProject, "mixed")).toBe(true);
  });

  it("renders lower timeline tracks first and keeps index zero on top", () => {
    const top = { ...track, id: "top", hidden: false };
    const hidden = { ...track, id: "hidden", hidden: true };
    const bottom = { ...track, id: "bottom", hidden: false };

    expect(
      getVisibleTrackRenderOrder([top, hidden, bottom]).map(
        ({ track: orderedTrack, originalIndex }) => [
          orderedTrack.id,
          originalIndex,
        ],
      ),
    ).toEqual([
      ["bottom", 2],
      ["top", 0],
    ]);
  });

  it("keeps legacy text and graphics tracks in front of media tracks", () => {
    const video = { ...track, id: "video", type: "video" as const };
    const text = { ...track, id: "text", type: "text" as const };
    const graphics = { ...track, id: "graphics", type: "graphics" as const };

    expect(isOverlayTrack(video)).toBe(false);
    expect(isOverlayTrack(text)).toBe(true);
    expect(
      getVisibleTrackRenderOrder([video, text, graphics]).map(({ track: item }) => item.id),
    ).toEqual(["video", "graphics", "text"]);
  });

  it("keeps overlay items on a legacy mixed track in front", () => {
    const video = { ...track, id: "video", type: "video" as const };
    const mixed = { ...track, id: "mixed", type: "video" as const };

    expect(
      getVisibleTrackRenderOrder([video, mixed], new Set(["mixed"])).map(
        ({ track: item }) => item.id,
      ),
    ).toEqual(["video", "mixed"]);
  });

  it("resolves media and overlays from one legacy-typed track", () => {
    expect(getTrackItems(project, "mixed").map((item) => item.kind)).toEqual([
      "media",
      "media",
      "text",
    ]);
    expect(getTimelineItems(project)).toHaveLength(3);
  });

  it("derives visual and audio behavior from content instead of track type", () => {
    const items = getTrackItems(project, "mixed");
    const video = items.find((item) => item.id === "video-clip")!;
    const audio = items.find((item) => item.id === "audio-clip")!;
    const text = items.find((item) => item.id === "text-clip")!;

    expect(getTimelineItemCapabilities(video)).toMatchObject({
      visual: true,
      audio: true,
    });
    expect(getTimelineItemCapabilities(audio)).toMatchObject({
      visual: false,
      audio: true,
    });
    expect(getTimelineItemCapabilities(text)).toMatchObject({
      visual: true,
      audio: false,
      textEditable: true,
    });
    expect(trackHasVisualItems(project, "mixed")).toBe(true);
    expect(trackHasAudioItems(project, "mixed")).toBe(true);
  });

  it("marks a project with the reader requirement exactly once", () => {
    const once = withUniversalTracksCapability(project);
    const twice = withUniversalTracksCapability(once);
    expect(once.capabilities).toContain(UNIVERSAL_TRACKS_CAPABILITY);
    expect(once.minimumReaderVersion).toBe("1.2.0");
    expect(twice).toBe(once);
  });
});
