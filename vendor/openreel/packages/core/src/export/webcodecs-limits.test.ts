import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_SETTINGS } from "./types";
import { resolveWebCodecsExportLimits } from "./webcodecs-limits";

describe("resolveWebCodecsExportLimits", () => {
  it("clamps long portrait exports by long and short edge", () => {
    const result = resolveWebCodecsExportLimits(
      {
        ...DEFAULT_VIDEO_SETTINGS,
        width: 2160,
        height: 3840,
        frameRate: 50,
      },
      221,
    );

    expect(result.settings).toMatchObject({
      width: 1080,
      height: 1920,
      frameRate: 30,
    });
    expect(result).toMatchObject({
      wasAdjusted: true,
      resolutionAdjusted: true,
      frameRateAdjusted: true,
    });
  });

  it("preserves a project-sized long portrait export", () => {
    const result = resolveWebCodecsExportLimits(
      {
        ...DEFAULT_VIDEO_SETTINGS,
        width: 1080,
        height: 1920,
        frameRate: 30,
      },
      221,
    );

    expect(result.settings).toMatchObject({
      width: 1080,
      height: 1920,
      frameRate: 30,
    });
    expect(result.wasAdjusted).toBe(false);
  });

  it("allows 4K portrait H.264 for shorter exports", () => {
    const result = resolveWebCodecsExportLimits(
      {
        ...DEFAULT_VIDEO_SETTINGS,
        width: 2160,
        height: 3840,
        frameRate: 50,
      },
      120,
    );

    expect(result.settings).toMatchObject({
      width: 2160,
      height: 3840,
      frameRate: 50,
    });
    expect(result.wasAdjusted).toBe(false);
  });

  it("applies the HD edge limit to memory-intensive codecs", () => {
    const result = resolveWebCodecsExportLimits(
      {
        ...DEFAULT_VIDEO_SETTINGS,
        codec: "h265",
        width: 3840,
        height: 2160,
      },
      30,
    );

    expect(result.settings).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(result.resolutionAdjusted).toBe(true);
    expect(result.frameRateAdjusted).toBe(false);
  });
});
