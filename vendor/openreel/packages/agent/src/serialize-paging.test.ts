import { describe, it, expect } from "vitest";
import { listClips, listOverlays, listTracks, listTransitions } from "./serialize";
import type { Project } from "@openreel/core/types/project";

function projectWithClips(n: number): Project {
  const clips = Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    mediaId: `m${i}`,
    trackId: "t1",
    startTime: i,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    effects: [],
    audioEffects: [],
    volume: 1,
    keyframes: [],
  }));
  return {
    id: "p1",
    name: "Many",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: n,
      subtitles: [],
      markers: [],
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips,
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

describe("listClips pagination", () => {
  it("returns all clips with no paging filter", () => {
    expect(listClips(projectWithClips(5))).toHaveLength(5);
  });

  it("applies limit", () => {
    const page = listClips(projectWithClips(10), { limit: 3 });
    expect(page).toHaveLength(3);
    expect(page[0].id).toBe("c0");
  });

  it("applies offset + limit", () => {
    const page = listClips(projectWithClips(10), { offset: 4, limit: 2 });
    expect(page.map((c) => c.id)).toEqual(["c4", "c5"]);
  });

  it("clamps offset past the end to an empty page", () => {
    expect(listClips(projectWithClips(3), { offset: 10, limit: 5 })).toHaveLength(0);
  });
});

describe("timeline readbacks", () => {
  it("exposes overlay and transition ownership for agent verification", () => {
    const project = projectWithClips(1);
    project.timeline.tracks.push({
      id: "t2",
      type: "text",
      name: "Text 1",
      clips: [],
      transitions: [{
        id: "tr1",
        clipAId: "c0",
        clipBId: "c1",
        type: "crossfade",
        duration: 0.25,
        params: {},
      }],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    });
    (project as unknown as { textClips: unknown[] }).textClips = [{
      id: "title-1",
      trackId: "t2",
      startTime: 0.5,
      duration: 1,
      text: "旅行",
      style: {},
      transform: {},
      keyframes: [],
      animation: { preset: "fade" },
      effects: [],
    }];

    expect(listTracks(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 1, id: "t2", layer: "overlay", type: "text" }),
    ]));
    expect(listOverlays(project)).toEqual([
      expect.objectContaining({
        id: "title-1",
        trackIndex: 1,
        startSec: 0.5,
        endSec: 1.5,
        animation: "fade",
      }),
    ]);
    expect(listTransitions(project)).toEqual([
      expect.objectContaining({
        id: "tr1",
        trackId: "t2",
        trackIndex: 1,
        type: "crossfade",
        durationSec: 0.25,
      }),
    ]);
  });
});
