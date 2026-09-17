import { describe, expect, it } from "vitest";
import { resolveCanvasFitDimensions } from "./canvas-fit";

describe("resolveCanvasFitDimensions", () => {
  const sourceWidth = 1920;
  const sourceHeight = 1080;
  const canvasWidth = 1080;
  const canvasHeight = 1920;

  it("contains a landscape source inside a portrait canvas", () => {
    expect(
      resolveCanvasFitDimensions(
        "contain",
        sourceWidth,
        sourceHeight,
        canvasWidth,
        canvasHeight,
      ),
    ).toEqual({ width: 1080, height: 607.5 });
  });

  it("treats a missing or none fit mode as contain", () => {
    const expected = { width: 1080, height: 607.5 };
    expect(
      resolveCanvasFitDimensions(
        undefined,
        sourceWidth,
        sourceHeight,
        canvasWidth,
        canvasHeight,
      ),
    ).toEqual(expected);
    expect(
      resolveCanvasFitDimensions(
        "none",
        sourceWidth,
        sourceHeight,
        canvasWidth,
        canvasHeight,
      ),
    ).toEqual(expected);
  });

  it("covers a portrait canvas without distorting the source", () => {
    const dimensions = resolveCanvasFitDimensions(
      "cover",
      sourceWidth,
      sourceHeight,
      canvasWidth,
      canvasHeight,
    );

    expect(dimensions.width).toBeCloseTo(3413.333, 3);
    expect(dimensions.height).toBe(1920);
  });

  it("stretches the source to the canvas", () => {
    expect(
      resolveCanvasFitDimensions(
        "stretch",
        sourceWidth,
        sourceHeight,
        canvasWidth,
        canvasHeight,
      ),
    ).toEqual({ width: 1080, height: 1920 });
  });

  it("uses the cropped source aspect ratio", () => {
    const dimensions = resolveCanvasFitDimensions(
      "cover",
      960,
      1080,
      canvasWidth,
      canvasHeight,
    );

    expect(dimensions.width).toBeCloseTo(1706.667, 3);
    expect(dimensions.height).toBe(1920);
  });

  it("returns safe dimensions for invalid inputs", () => {
    expect(resolveCanvasFitDimensions("cover", 0, 0, 1080, 1920)).toEqual({
      width: 1080,
      height: 1920,
    });
  });
});
