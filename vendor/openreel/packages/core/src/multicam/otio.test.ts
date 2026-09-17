import { describe, expect, it } from "vitest";
import { DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS } from "./manifest";
import { multicamPlanToOtio } from "./otio";

describe("multicam OTIO export", () => {
  it("emits one OTIO track for each simultaneous panel", () => {
    const manifest = {
      spec: "openreel-multicam/v1" as const,
      fps: 25,
      sync: { method: "audio-crosscorr" as const, reference: "wide" },
      participants: [
        { id: "p1", name: "A", audio: "a", seat: "left" as const },
        { id: "p2", name: "B", audio: "b", seat: "right" as const },
      ],
      cameras: [
        { id: "a", type: "closeup" as const, subject: "p1", file: "a.mp4" },
        { id: "b", type: "closeup" as const, subject: "p2", file: "b.mp4" },
        { id: "wide", type: "wide" as const, subject: "all", file: "wide.mp4" },
      ],
      constraints: DEFAULT_MULTICAM_MANIFEST_CONSTRAINTS,
    };
    const otio = multicamPlanToOtio({
      spec: "openreel-multicam-edit/v1",
      durationMs: 2_000,
      shots: [{
        startMs: 0,
        endMs: 2_000,
        reason: "sustained-overlap",
        confidence: 0.9,
        transitionIn: { type: "layout-morph", durationMs: 200 },
        layout: {
          template: "split2",
          panels: [
            { cameraId: "a", subject: "p1", rect: { x: 0, y: 0, width: 0.5, height: 1 } },
            { cameraId: "b", subject: "p2", rect: { x: 0.5, y: 0, width: 0.5, height: 1 } },
          ],
        },
      }],
    }, manifest) as unknown as { tracks: { children: Array<{ children: unknown[] }> } };

    expect(otio.tracks.children).toHaveLength(2);
    expect(otio.tracks.children.every((track) => track.children.length === 1)).toBe(true);
  });
});
