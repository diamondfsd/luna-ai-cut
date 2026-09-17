import { describe, expect, it } from "vitest";
import { DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS } from "./manifest";
import {
  detectMulticamReactionCues,
  incorporateMulticamReactionCues,
} from "./reaction-analysis";

describe("multicam reaction analysis", () => {
  it("merges adjacent face signals and inserts listener shots", () => {
    const cues = detectMulticamReactionCues([
      { participantId: "p2", timeMs: 1_000, smile: 0.8, surprise: 0.1, headMotion: 0.1 },
      { participantId: "p2", timeMs: 1_500, smile: 0.9, surprise: 0.1, headMotion: 0.1 },
    ]);
    expect(cues).toHaveLength(1);
    const manifest = {
      spec: "openreel-multicam/v1" as const,
      fps: 25,
      sync: { method: "audio-crosscorr" as const, reference: "a" },
      participants: [
        { id: "p1", name: "A", audio: "a", seat: "left" as const },
        { id: "p2", name: "B", audio: "b", seat: "right" as const },
      ],
      cameras: [
        { id: "a", type: "closeup" as const, subject: "p1", file: "a.mp4" },
        { id: "b", type: "closeup" as const, subject: "p2", file: "b.mp4" },
      ],
      constraints: DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
    };
    const result = incorporateMulticamReactionCues({
      spec: "openreel-multicam-edit/v1",
      durationMs: 4_000,
      shots: [{
        startMs: 0,
        endMs: 4_000,
        layout: { template: "solo", panels: [{ cameraId: "a", subject: "p1", rect: { x: 0, y: 0, width: 1, height: 1 } }] },
        transitionIn: { type: "cut", durationMs: 0 },
        reason: "speaker",
        confidence: 1,
      }],
    }, manifest, cues);

    expect(result.shots.some((shot) =>
      shot.reason === "reaction-shot" && shot.layout.panels[0]?.cameraId === "b",
    )).toBe(true);
  });
});
