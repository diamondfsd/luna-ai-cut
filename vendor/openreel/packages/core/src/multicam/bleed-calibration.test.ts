import { describe, expect, it } from "vitest";
import {
  calibrateMulticamBleed,
  correctMulticamBleedEnergies,
} from "./bleed-calibration";

const samples = (amplitude: number): Float32Array =>
  Float32Array.from({ length: 1_000 }, (_, index) =>
    amplitude * Math.sin((index / 1_000) * Math.PI * 40),
  );

describe("multicam bleed calibration", () => {
  it("learns directional bleed ratios from isolated speech", () => {
    const calibration = calibrateMulticamBleed(
      [
        { angleId: "a", samples: samples(1), sampleRate: 1_000 },
        { angleId: "b", samples: samples(0.2), sampleRate: 1_000 },
      ],
      [{ speakerAngleId: "a", startTime: 0, endTime: 1 }],
    );

    expect(calibration.ratios.a?.b).toBeCloseTo(0.2, 2);
    expect(calibration.ratios.a?.a).toBe(1);
  });

  it("subtracts predicted bleed while preserving independent speech", () => {
    const calibration = {
      spec: "openreel-bleed-calibration/v1" as const,
      angleIds: ["a", "b"],
      ratios: { a: { a: 1, b: 0.2 }, b: { a: 0.1, b: 1 } },
      noiseFloor: { a: 0, b: 0 },
    };

    expect(correctMulticamBleedEnergies({ a: 1, b: 0.2 }, calibration)).toEqual({
      a: 0.98,
      b: 0,
    });
    expect(correctMulticamBleedEnergies({ a: 1, b: 0.8 }, calibration).b).toBeCloseTo(
      0.6,
    );
  });
});
