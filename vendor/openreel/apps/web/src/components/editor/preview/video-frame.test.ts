import { afterEach, describe, expect, it, vi } from "vitest";
import { captureNativeVideoFrame } from "./video-frame";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureNativeVideoFrame", () => {
  it("captures the native video source without canvas-sized background padding", async () => {
    const video = {} as HTMLVideoElement;
    const nativeFrame = { width: 720, height: 1280 } as ImageBitmap;
    const createBitmap = vi.fn().mockResolvedValue(nativeFrame);
    vi.stubGlobal("createImageBitmap", createBitmap);

    await expect(captureNativeVideoFrame(video)).resolves.toBe(nativeFrame);
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(createBitmap).toHaveBeenCalledWith(video);
  });
});
