import { afterEach, describe, expect, it, vi } from "vitest";
import { titleEngine } from "../text/title-engine";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM } from "../text/types";
import type { TextClip } from "../text/types";

describe("VideoEngine text output scaling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes the project-to-output ratio to TitleEngine", async () => {
    vi.stubGlobal("self", {
      onmessage: null,
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const renderedCanvas = {} as OffscreenCanvas;
    const renderText = vi.spyOn(titleEngine, "renderText").mockReturnValue({
      canvas: renderedCanvas,
      width: 540,
      height: 960,
      textMetrics: { width: 0, height: 0, lines: [] },
    });
    const ctx = {
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const clip: TextClip = {
      id: "title-1",
      trackId: "text-track",
      startTime: 0,
      duration: 5,
      text: "Scaled title",
      style: DEFAULT_TEXT_STYLE,
      transform: DEFAULT_TEXT_TRANSFORM,
      keyframes: [],
      effects: [],
    };

    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as {
      renderTextClipToCanvasCtx(
        context: OffscreenCanvasRenderingContext2D,
        textClip: TextClip,
        time: number,
        width: number,
        height: number,
        projectWidth: number,
        projectHeight: number,
      ): Promise<void>;
    };

    await engine.renderTextClipToCanvasCtx(
      ctx,
      clip,
      0,
      540,
      960,
      1080,
      1920,
    );

    expect(renderText).toHaveBeenCalledWith(clip, 540, 960, 0, {
      x: 0.5,
      y: 0.5,
    });
    expect(ctx.drawImage).toHaveBeenCalledWith(renderedCanvas, 0, 0);
  });

  it("renders persisted behind-subject text normally without browser inference", async () => {
    vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn() });
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as {
      renderTextClipWithSubjectMask(
        ctx: OffscreenCanvasRenderingContext2D,
        clip: TextClip,
        time: number,
        width: number,
        height: number,
        projectWidth: number,
        projectHeight: number,
        subject: ImageBitmap,
        realtime: boolean,
        streamId: string,
      ): Promise<void>;
      renderTextClipToCanvasCtx(): Promise<void>;
      getSubjectMaskForFrame(): Promise<null>;
    };
    const render = vi.spyOn(engine, "renderTextClipToCanvasCtx").mockResolvedValue();
    const infer = vi.spyOn(engine, "getSubjectMaskForFrame").mockResolvedValue(null);
    const clip: TextClip = {
      id: "legacy-title",
      trackId: "text-track",
      startTime: 0,
      duration: 5,
      text: "Preserved title",
      behindSubject: true,
      style: DEFAULT_TEXT_STYLE,
      transform: DEFAULT_TEXT_TRANSFORM,
      keyframes: [],
      effects: [],
    };
    for (const realtime of [true, false]) {
      await engine.renderTextClipWithSubjectMask(
        {} as OffscreenCanvasRenderingContext2D,
        clip, 0, 1920, 1080, 1920, 1080,
        {} as ImageBitmap, realtime, "legacy-title",
      );
    }
    expect(render).toHaveBeenCalledTimes(2);
    expect(infer).not.toHaveBeenCalled();
    expect(clip.behindSubject).toBe(true);
  });

});
