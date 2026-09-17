import { describe, expect, it } from "vitest";
import { DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS } from "./manifest";
import {
  createOrmaArtifact,
  deserializeOrma,
  isOrmaCompatible,
  serializeOrma,
} from "./orma";

const manifest = {
  spec: "openreel-multicam/v1" as const,
  fps: 25,
  sync: { method: "audio-crosscorr" as const, reference: "wide" },
  participants: [
    { id: "p1", name: "Alex", audio: "a", seat: "left" as const },
    { id: "p2", name: "Jamie", audio: "b", seat: "right" as const },
  ],
  cameras: [
    { id: "a", type: "closeup" as const, subject: "p1", file: "a.mp4" },
    { id: "b", type: "closeup" as const, subject: "p2", file: "b.mp4" },
    { id: "wide", type: "wide" as const, subject: "all", file: "wide.mp4" },
  ],
  constraints: DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
};

const media = [
  { id: "a", name: "a.mp4", size: 100, lastModified: 10 },
  { id: "b", name: "b.mp4", size: 200, lastModified: 20 },
];

describe(".orma activity artifacts", () => {
  it("round-trips reusable analysis separately from the edit policy", () => {
    const artifact = createOrmaArtifact({
      manifest,
      media,
      createdAt: 123,
      activity: {
        angleIds: ["a", "b"],
        duration: 1,
        windowMs: 50,
        points: [
          {
            startTime: 0,
            endTime: 1,
            activeAngleIds: ["a"],
            scores: { a: 1, b: 0.1 },
          },
        ],
      },
    });

    expect(deserializeOrma(serializeOrma(artifact))).toEqual(artifact);
    expect(isOrmaCompatible(artifact, manifest, [...media].reverse())).toBe(true);
  });

  it("invalidates the cache when source media changes", () => {
    const artifact = createOrmaArtifact({
      manifest,
      media,
      activity: { angleIds: [], duration: 0, windowMs: 50, points: [] },
    });

    expect(
      isOrmaCompatible(artifact, manifest, [
        { ...media[0]!, size: 101 },
        media[1]!,
      ]),
    ).toBe(false);
  });
});
