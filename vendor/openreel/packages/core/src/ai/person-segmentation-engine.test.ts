import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonSegmentationEngine, PERSON_SEGMENTATION_AVAILABLE } from "./person-segmentation-engine";

afterEach(() => vi.unstubAllGlobals());

describe("removed browser person models", () => {
  it("does not fetch models or create workers, including for persisted effects", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected model download"); });
    const worker = vi.fn(() => { throw new Error("Unexpected inference worker"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Worker", worker);
    const engine = new PersonSegmentationEngine();
    await engine.initialize();
    expect(PERSON_SEGMENTATION_AVAILABLE).toBe(false);
    expect(engine.isInitialized()).toBe(false);
    const close = vi.fn();
    const frame = { close } as unknown as ImageBitmap;
    expect(await engine.getPersonMask(frame, { realtime: true })).toBeNull();
    expect(await engine.getPersonMask(frame, { realtime: false })).toBeNull();
    engine.dispose();
    expect(fetch).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
