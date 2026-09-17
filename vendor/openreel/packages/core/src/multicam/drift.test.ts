import { describe, expect, it } from "vitest";
import {
  analyzeMulticamDrift,
  fitMulticamDriftModel,
  multicamOffsetAt,
  multicamSourceTime,
} from "./drift";

describe("multicam drift", () => {
  it("fits a weighted linear clock model", () => {
    const model = fitMulticamDriftModel([
      { timeSeconds: 0, offsetSeconds: 0.1, confidence: 1 },
      { timeSeconds: 1_800, offsetSeconds: 0.19, confidence: 0.9 },
      { timeSeconds: 3_600, offsetSeconds: 0.28, confidence: 1 },
    ]);

    expect(model.interceptSeconds).toBeCloseTo(0.1, 5);
    expect(model.partsPerMillion).toBeCloseTo(50, 2);
    expect(multicamOffsetAt(model, 3_600)).toBeCloseTo(0.28, 5);
    expect(multicamSourceTime(model, 100)).toBeCloseTo(100.105, 4);
  });

  it("measures a fixed offset with FFT block correlation", () => {
    const sampleRate = 1_000;
    const duration = 12;
    const reference = new Float32Array(sampleRate * duration);
    for (let index = 0; index < reference.length; index++) {
      reference[index] =
        Math.sin(index * 0.071) * 0.6 + Math.sin(index * 0.019) * 0.3;
    }
    const target = new Float32Array(reference.length);
    const delay = 0.2 * sampleRate;
    for (let index = delay; index < target.length; index++) {
      target[index] = reference[index - delay] ?? 0;
    }

    const model = analyzeMulticamDrift(reference, target, sampleRate, {
      blockSeconds: 2,
      intervalSeconds: 3,
      maxOffsetSeconds: 0.5,
      analysisSampleRate: 250,
    });

    expect(model.interceptSeconds).toBeCloseTo(0.2, 2);
    expect(model.confidence).toBeGreaterThan(0.8);
  });
});
