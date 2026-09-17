import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import {
  AutoSaveManager,
  serializeProjectForAutoSave,
} from "./auto-save";
import { createEmptyProject } from "../stores/project/project-helpers";

const project = (name: string): Project => ({
  ...createEmptyProject(name),
  id: "project-1",
});

describe("AutoSaveManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the snapshot supplied with the dirty notification", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ debounceTime: 10, interval: 30_000 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;

    manager.start(() => project("Initial"));
    manager.markDirty(project("Latest text edit"));
    await vi.advanceTimersByTimeAsync(10);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Latest text edit" }),
    );
    manager.stop();
  });

  it("strips runtime-only media payloads from serialized snapshots", () => {
    const source = project("Media project");
    const snapshot: Project = {
      ...source,
      mediaLibrary: {
        items: [
          {
            id: "media-1",
            name: "clip.mp4",
            type: "video",
            fileHandle: {} as FileSystemFileHandle,
            blob: new Blob(["video"], { type: "video/mp4" }),
            metadata: {
              duration: 5,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "h264",
              sampleRate: 48000,
              channels: 2,
              fileSize: 5,
            },
            thumbnailUrl: "blob:stale-thumbnail",
            waveformData: new Float32Array([0.1, 0.2]),
            filmstripThumbnails: [
              { timestamp: 0, url: "blob:stale-filmstrip" },
            ],
            sourceFile: {
              name: "clip.mp4",
              size: 5,
              lastModified: 123,
            },
          },
        ],
      },
    };

    const serialized = JSON.parse(serializeProjectForAutoSave(snapshot)) as {
      mediaLibrary: { items: Array<Record<string, unknown>> };
    };

    expect(serialized.mediaLibrary.items[0]).toMatchObject({
      blob: null,
      fileHandle: null,
      waveformData: null,
      thumbnailUrl: null,
      sourceFile: {
        name: "clip.mp4",
        size: 5,
        lastModified: 123,
      },
    });
    expect(serialized.mediaLibrary.items[0]).not.toHaveProperty(
      "filmstripThumbnails",
    );
  });
});
