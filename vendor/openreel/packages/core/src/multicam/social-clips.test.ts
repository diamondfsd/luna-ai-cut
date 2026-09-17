import { describe, expect, it } from "vitest";
import { extractMulticamSocialClips } from "./social-clips";

describe("multicam social clip extraction", () => {
  it("ranks active, reactive, transcript-rich windows deterministically", () => {
    const points = Array.from({ length: 120 }, (_, index) => ({
      startTime: index,
      endTime: index + 1,
      activeAngleIds: index >= 40 && index < 80 ? [index % 2 ? "a" : "b"] : [],
      scores: { a: index % 2, b: (index + 1) % 2 },
    }));
    const result = extractMulticamSocialClips({
      spec: "openreel-activity/v1",
      manifestFingerprint: "m",
      mediaFingerprint: "f",
      createdAt: 1,
      durationMs: 120_000,
      activity: { angleIds: ["a", "b"], duration: 120, windowMs: 1_000, points },
      drift: {},
      reactions: [{ participantId: "p2", startMs: 50_000, endMs: 51_000, confidence: 0.9, kind: "smile" }],
      transcripts: { a: [{ startMs: 45_000, endMs: 55_000, text: "A concise memorable podcast moment with a strong reaction" }] },
    }, { count: 1, durationMs: 30_000, stepMs: 10_000 });

    expect(result).toHaveLength(1);
    expect(result[0]?.startMs).toBeGreaterThanOrEqual(20_000);
    expect(result[0]?.startMs).toBeLessThanOrEqual(50_000);
  });
});
