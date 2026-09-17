import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import {
  createMissingMediaItem,
  generateThumbnailFromBlob,
  restoreMediaItem,
} from "./media-recovery";

function mockCreateObjectURL(
  implementation: (blob: Blob) => string = () => "blob:thumbnail",
) {
  const mock = vi.fn(implementation);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: mock,
  });
  return mock;
}

function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "media-1",
    name: "clip.png",
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 1920,
      height: 1080,
      frameRate: 0,
      codec: "png",
      sampleRate: 0,
      channels: 0,
      fileSize: 5,
    },
    thumbnailUrl: "blob:stale-thumbnail",
    waveformData: null,
    filmstripThumbnails: [
      { timestamp: 0, url: "blob:stale-filmstrip" },
    ],
    sourceFile: {
      name: "clip.png",
      size: 5,
      lastModified: 123,
    },
    ...overrides,
  };
}

describe("media recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
  });

  it("marks a JSON blob placeholder as missing without creating an object URL", async () => {
    const createObjectURL = mockCreateObjectURL();
    const item = mediaItem({
      blob: {} as Blob,
      fileHandle: {} as FileSystemFileHandle,
      waveformData: {} as Float32Array,
    });

    const restored = await restoreMediaItem(item, undefined);

    expect(restored).toMatchObject({
      id: "media-1",
      fileHandle: null,
      blob: null,
      thumbnailUrl: null,
      waveformData: null,
      isPlaceholder: true,
    });
    expect(restored.filmstripThumbnails).toBeUndefined();
    expect(restored.sourceFile).toEqual(item.sourceFile);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("restores an IndexedDB blob instead of the serialized placeholder", async () => {
    const storedBlob = new Blob(["image"], { type: "image/png" });
    const createObjectURL = mockCreateObjectURL(
      () => "blob:restored-thumbnail",
    );
    const item = mediaItem({ blob: {} as Blob, isPlaceholder: true });

    const restored = await restoreMediaItem(item, storedBlob);

    expect(restored.blob).toBe(storedBlob);
    expect(restored.thumbnailUrl).toBe("blob:restored-thumbnail");
    expect(restored.isPlaceholder).toBe(false);
    expect(createObjectURL).toHaveBeenCalledWith(storedBlob);
  });

  it("keeps recovered media usable when thumbnail regeneration fails", async () => {
    const storedBlob = new Blob(["image"], { type: "image/png" });
    mockCreateObjectURL(() => {
      throw new TypeError("thumbnail failure");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const restored = await restoreMediaItem(mediaItem(), storedBlob);

    expect(restored.blob).toBe(storedBlob);
    expect(restored.thumbnailUrl).toBeNull();
    expect(restored.isPlaceholder).toBe(false);
  });

  it("rejects non-Blob input at the thumbnail boundary", async () => {
    const createObjectURL = mockCreateObjectURL();

    await expect(
      generateThumbnailFromBlob({} as Blob, "image"),
    ).resolves.toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("creates a relinkable placeholder while preserving source hints", () => {
    const item = mediaItem();

    expect(createMissingMediaItem(item)).toMatchObject({
      id: item.id,
      blob: null,
      isPlaceholder: true,
      sourceFile: item.sourceFile,
    });
  });
});
