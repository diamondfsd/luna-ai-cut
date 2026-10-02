import { expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
const h = vi.hoisted(() => ({ detect: vi.fn() }));
vi.mock("@openreel/core/audio/beat-detection-engine", () => ({ getBeatDetectionEngine: () => ({ analyzeFromBlob: h.detect }) }));
import { analyzeMediaItemBeats } from "./media-beat-analysis";

it("uses persisted generated score timing without re-detecting or shifting its phase", async () => {
  const item = { name: "music.wav", type: "audio", musicTiming: {
    source: "generated-score", bpm: 120, duration: 2,
    beatTimes: [0, 0.5, 1, 1.5], downbeats: [0],
    percussionHits: [{ time: 0, pitch: 36, velocity: 90 }],
  } } as unknown as MediaItem;
  const result = await analyzeMediaItemBeats(item);
  expect(result.beats.map(beat => beat.time)).toEqual([0, 0.5, 1, 1.5]);
  expect(result.confidence).toBe(1);
  expect(h.detect).not.toHaveBeenCalled();
});

it("still detects the waveform for externally supplied music", async () => {
  const blob = new File([new ArrayBuffer(8)], "external.wav");
  h.detect.mockResolvedValue({ bpm: 97, confidence: 0.8 });
  await analyzeMediaItemBeats({ name: "external.wav", type: "audio", blob } as unknown as MediaItem);
  expect(h.detect).toHaveBeenCalledWith(blob);
});
