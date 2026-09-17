import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITING_FRAME_RATE,
  EDITING_FRAME_RATE_OPTIONS,
  editingFrameDurationMs,
  editingFrameStepSeconds,
  normalizeEditingFrameRate,
} from "./editing-frame-rate";

describe("editing frame rate", () => {
  it("offers standard editorial frame rates including 60 fps", () => {
    expect(EDITING_FRAME_RATE_OPTIONS.map((option) => option.value)).toEqual([
      23.976,
      24,
      25,
      29.97,
      30,
      50,
      59.94,
      60,
    ]);
  });

  it("drives preview cadence and frame stepping from the project rate", () => {
    expect(editingFrameDurationMs(60)).toBeCloseTo(16.667, 2);
    expect(editingFrameStepSeconds(60)).toBeCloseTo(1 / 60, 8);
  });

  it("falls back safely for invalid project data", () => {
    expect(normalizeEditingFrameRate(0)).toBe(DEFAULT_EDITING_FRAME_RATE);
    expect(normalizeEditingFrameRate(Number.NaN)).toBe(
      DEFAULT_EDITING_FRAME_RATE,
    );
    expect(normalizeEditingFrameRate(1000)).toBe(240);
  });
});
