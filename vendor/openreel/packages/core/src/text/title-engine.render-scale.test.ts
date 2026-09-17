import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleEngine } from "./title-engine";

describe("TitleEngine render scale", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scales project-space text pixels for a smaller output canvas", () => {
    const scale = vi.fn();
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale,
      measureText: vi.fn(() => ({ width: 200 })),
      fillRect: vi.fn(),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      textAlign: "center",
      textBaseline: "middle",
      globalAlpha: 1,
      shadowColor: "transparent",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      letterSpacing: "0px",
    };

    class MockOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext() {
        return ctx;
      }
    }

    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);

    const engine = new TitleEngine();
    const clip = engine.createTextClip({
      trackId: "text-track",
      startTime: 0,
      text: "Scaled title",
      style: {
        fontSize: 96,
        strokeWidth: 4,
        letterSpacing: 8,
      },
    });

    const result = engine.renderText(clip, 540, 960, 0, {
      x: 540 / 1080,
      y: 960 / 1920,
    });

    expect(result).toMatchObject({ width: 540, height: 960 });
    expect(scale).toHaveBeenCalledWith(0.5, 0.5);
    expect(ctx.font).toBe('normal bold 96px "Inter"');
    expect(ctx.lineWidth).toBe(4);
    expect(ctx.letterSpacing).toBe("8px");
  });
});
