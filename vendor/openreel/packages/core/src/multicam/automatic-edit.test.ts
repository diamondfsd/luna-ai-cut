import { describe, expect, it } from "vitest";
import {
  analyzeMulticamActivity,
  decideMulticamEdit,
  DEFAULT_MULTICAM_EDIT_POLICY,
  type MulticamActivityMap,
  type MulticamEditPolicy,
} from "./automatic-edit";

const sampleRate = 1_000;

function signal(ranges: Array<[number, number, number]>, duration = 8): Float32Array {
  const samples = new Float32Array(duration * sampleRate);
  for (const [start, end, amplitude] of ranges) {
    for (let index = start * sampleRate; index < end * sampleRate; index++) {
      samples[index] = amplitude * Math.sin((2 * Math.PI * 50 * index) / sampleRate);
    }
  }
  return samples;
}

function activityMap(
  selections: Array<{ angleIds: string[]; scores: [number, number] }>,
  windowSeconds = 1,
): MulticamActivityMap {
  return {
    angleIds: ["a", "b"],
    duration: selections.length * windowSeconds,
    windowMs: windowSeconds * 1_000,
    points: selections.map((selection, index) => ({
      startTime: index * windowSeconds,
      endTime: (index + 1) * windowSeconds,
      activeAngleIds: selection.angleIds,
      scores: { a: selection.scores[0], b: selection.scores[1] },
    })),
  };
}

const policy = (updates: Partial<MulticamEditPolicy> = {}): MulticamEditPolicy => ({
  ...DEFAULT_MULTICAM_EDIT_POLICY,
  maxShotMs: 0,
  minShotMs: 0,
  cutLeadMs: 0,
  backchannelMaxMs: 0,
  ...updates,
});

describe("analyzeMulticamActivity", () => {
  it("maps isolated speakers to their camera angles", () => {
    const activity = analyzeMulticamActivity(
      [
        { angleId: "a", samples: signal([[0, 4, 0.8]]), sampleRate },
        { angleId: "b", samples: signal([[4, 8, 0.8]]), sampleRate },
      ],
      { windowMs: 500 },
    );

    expect(activity.points[2]?.activeAngleIds).toEqual(["a"]);
    expect(activity.points[10]?.activeAngleIds).toEqual(["b"]);
  });

  it("suppresses a quieter copy of the dominant microphone as bleed", () => {
    const activity = analyzeMulticamActivity(
      [
        { angleId: "a", samples: signal([[1, 4, 0.8]], 5), sampleRate },
        { angleId: "b", samples: signal([[1, 4, 0.2]], 5), sampleRate },
      ],
      { windowMs: 500, bleedRatio: 0.55 },
    );

    expect(activity.points[3]?.activeAngleIds).toEqual(["a"]);
    expect(activity.points[3]?.scores.b).toBeCloseTo(0.25, 1);
  });

  it("does not classify digital silence as speaker activity", () => {
    const activity = analyzeMulticamActivity([
      { angleId: "a", samples: signal([], 2), sampleRate },
      { angleId: "b", samples: signal([], 2), sampleRate },
    ]);

    expect(activity.points.every((point) => point.activeAngleIds.length === 0)).toBe(true);
  });

  it("honors source offsets while constructing the shared activity timeline", () => {
    const activity = analyzeMulticamActivity(
      [
        { angleId: "a", samples: signal([[0, 1, 0.8]], 3), sampleRate },
        {
          angleId: "b",
          samples: signal([[1, 2, 0.8]], 3),
          sampleRate,
          offsetSeconds: 1,
        },
      ],
      { windowMs: 500, durationSeconds: 1 },
    );

    expect(activity.points[0]?.activeAngleIds).toEqual(["a", "b"]);
  });

  it("uses Silero probabilities to reject non-speech energy", () => {
    const activity = analyzeMulticamActivity(
      [
        {
          angleId: "a",
          samples: signal([[0, 2, 0.8]], 2),
          sampleRate,
          vad: { windowMs: 500, probabilities: new Float32Array([0.1, 0.1, 0.9, 0.9]) },
        },
        { angleId: "b", samples: signal([], 2), sampleRate },
      ],
      { windowMs: 500 },
    );

    expect(activity.points[0]?.activeAngleIds).toEqual([]);
    expect(activity.points[2]?.activeAngleIds).toEqual(["a"]);
  });
});

describe("decideMulticamEdit", () => {
  it("cuts to the newly active speaker with the configured lead", () => {
    const activity = activityMap([
      { angleIds: ["a"], scores: [1, 0] },
      { angleIds: ["a"], scores: [1, 0] },
      { angleIds: ["b"], scores: [0, 1] },
      { angleIds: ["b"], scores: [0, 1] },
    ]);

    const edit = decideMulticamEdit(activity, policy({ cutLeadMs: 200 }));

    expect(edit.segments).toHaveLength(2);
    expect(edit.segments[0]).toMatchObject({ angleId: "a", endTime: 1.8 });
    expect(edit.segments[1]).toMatchObject({
      angleId: "b",
      startTime: 1.8,
      reason: "speaker",
    });
  });

  it("ignores a brief backchannel between longer shots of the same speaker", () => {
    const activity = activityMap(
      [
        { angleIds: ["a"], scores: [1, 0] },
        { angleIds: ["a"], scores: [1, 0] },
        { angleIds: ["b"], scores: [0, 1] },
        { angleIds: ["a"], scores: [1, 0] },
      ],
      0.5,
    );

    const edit = decideMulticamEdit(activity, policy({ backchannelMaxMs: 600 }));

    expect(edit.segments).toEqual([
      expect.objectContaining({ angleId: "a", startTime: 0, endTime: 2 }),
    ]);
  });

  it("holds the current angle during overlap or chooses the energy winner", () => {
    const activity = activityMap([
      { angleIds: ["a"], scores: [1, 0] },
      { angleIds: ["a", "b"], scores: [0.7, 1] },
      { angleIds: ["b"], scores: [0, 1] },
    ]);

    const hold = decideMulticamEdit(activity, policy({ overlapStrategy: "hold" }));
    const winner = decideMulticamEdit(activity, policy({ overlapStrategy: "winner" }));

    expect(hold.segments[0]?.endTime).toBe(2);
    expect(winner.segments[0]?.endTime).toBe(1);
    expect(winner.segments[1]).toMatchObject({
      angleId: "b",
      reason: "overlap-winner",
    });
  });

  it("enforces minimum shot length without losing a persistent speaker change", () => {
    const activity = activityMap([
      { angleIds: ["a"], scores: [1, 0] },
      { angleIds: ["b"], scores: [0, 1] },
      { angleIds: ["b"], scores: [0, 1] },
      { angleIds: ["b"], scores: [0, 1] },
    ]);

    const edit = decideMulticamEdit(activity, policy({ minShotMs: 2_000 }));

    expect(edit.segments[0]?.endTime).toBe(2);
    expect(edit.segments[1]?.angleId).toBe("b");
  });

  it("adds deterministic reaction shots when a camera exceeds max shot length", () => {
    const activity = activityMap(
      Array.from({ length: 8 }, () => ({
        angleIds: ["a"],
        scores: [1, 0.2] as [number, number],
      })),
    );

    const edit = decideMulticamEdit(
      activity,
      policy({ maxShotMs: 3_000, reactionShotMs: 1_000, minShotMs: 1_000 }),
    );

    expect(edit.segments).toEqual([
      expect.objectContaining({ angleId: "a", startTime: 0, endTime: 3 }),
      expect.objectContaining({ angleId: "b", startTime: 3, endTime: 4, reason: "max-shot" }),
      expect.objectContaining({ angleId: "a", startTime: 4, endTime: 7 }),
      expect.objectContaining({ angleId: "b", startTime: 7, endTime: 8, reason: "max-shot" }),
    ]);
  });

  it("is deterministic for the same activity and policy", () => {
    const activity = activityMap([
      { angleIds: ["a"], scores: [1, 0.2] },
      { angleIds: ["a", "b"], scores: [0.8, 1] },
      { angleIds: ["b"], scores: [0.1, 1] },
    ]);
    const editPolicy = policy({ overlapStrategy: "winner", cutLeadMs: 100 });

    expect(decideMulticamEdit(activity, editPolicy)).toEqual(
      decideMulticamEdit(activity, editPolicy),
    );
  });
});
