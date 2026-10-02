import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeProjectForAutoSave } from "../auto-save";
import type { MediaItem, Project } from "@openreel/core";
import { importLunaLocalMedia } from "./local-media-import";
import { hydrateLunaMediaItems } from "../../stores/project/media-slice";

interface TestState {
  project: { id: string; mediaLibrary: { items: MediaItem[] } };
  importMedia: (file: File) => Promise<{ success: boolean; actionId: string }>;
  replaceMediaAsset: () => Promise<{ success: boolean }>;
}
const h = vi.hoisted(() => ({ state: {} as TestState, set: vi.fn() }));
vi.mock("../../stores/project-store", () => ({ useProjectStore: {
  getState: () => h.state,
  setState: (value: Partial<TestState>) => { Object.assign(h.state, value); h.set(value); },
} }));

describe("native local media recovery", () => {
  beforeEach(() => {
    h.state = {
      project: { id: "p1", mediaLibrary: { items: [] } },
      importMedia: vi.fn(async (file: File) => {
        h.state.project.mediaLibrary.items.push({ id: "m1", name: file.name, type: "audio", blob: file, metadata: { duration: 21 } } as unknown as MediaItem);
        return { success: true, actionId: "m1" };
      }),
      replaceMediaAsset: vi.fn(async () => ({ success: true })),
    };
    Reflect.set(window, "openreel", { lunaMedia: {
      getLocalMedia: async () => ({ name: "music.wav", kind: "audio", sourcePath: "/local/music.wav", musicTiming: {
        source: "generated-score", bpm: 120, duration: 21,
        beatTimes: [0, 0.5, 1], downbeats: [0], percussionHits: [{ time: 0, pitch: 36, velocity: 90 }],
      } }),
      readLocalMediaBytes: async () => new ArrayBuffer(8),
      readFileBytes: async () => new ArrayBuffer(8),
    } });
  });

  it("persists the native source even when blobs are stripped", async () => {
    await importLunaLocalMedia("m1", { wav: "audio/wav" });
    const item = h.state.project.mediaLibrary.items[0];
    expect(item.sourcePath).toBe("/local/music.wav");
    // The save serializer may remove browser-only data but must retain recovery.
    const saved = JSON.parse(serializeProjectForAutoSave(h.state.project as unknown as Project));
    expect(saved.mediaLibrary.items[0].sourcePath).toBe("/local/music.wav");
    const [restored] = await hydrateLunaMediaItems(saved.mediaLibrary.items);
    expect(restored.isPlaceholder).toBe(false);
    expect(restored.blob?.size).toBe(8);
    expect(restored.blob?.type).toBe("audio/wav");
    expect(restored.musicTiming?.beatTimes).toEqual([0, 0.5, 1]);
  });

  it("reimports missing media instead of accepting a placeholder", async () => {
    h.state.project.mediaLibrary.items.push({ id: "m1", isPlaceholder: true, type: "audio", metadata: { duration: 21 } } as unknown as MediaItem);
    await importLunaLocalMedia("m1", { wav: "audio/wav" });
    expect(h.state.replaceMediaAsset).toHaveBeenCalledWith("m1", expect.any(File));
    expect(h.state.importMedia).not.toHaveBeenCalled();
  });
});
