import type { MediaItem } from "@openreel/core";
import { getBeatDetectionEngine, type BeatAnalysisResult } from "@openreel/core/audio/beat-detection-engine";

/** Generated audio already has authoritative timing from its rendered MIDI. */
export async function analyzeMediaItemBeats(item: MediaItem): Promise<BeatAnalysisResult> {
  const timing = item.musicTiming;
  if (timing?.source === "generated-score") {
    return {
      bpm: timing.bpm, confidence: 1, duration: timing.duration,
      beats: timing.beatTimes.map((time, index) => ({ time, index, strength:
        timing.percussionHits.some(hit => Math.abs(hit.time - time) < 0.001 && hit.velocity >= 50) ? 1 : 0.5 })),
      downbeats: [...timing.downbeats],
    };
  }
  let blob = item.blob;
  const readFileBytes = window.openreel?.lunaMedia?.readFileBytes;
  if (!blob && item.sourcePath && readFileBytes) {
    const bytes = await readFileBytes(item.sourcePath);
    blob = new File([bytes], item.name, { type: item.type === "audio" ? "audio/wav" : "video/mp4" });
  }
  if (!blob && item.originalUrl) {
    const response = await fetch(item.originalUrl);
    if (response.ok) blob = await response.blob();
  }
  if (!blob) throw new Error(`Media ${item.name} is unavailable for beat analysis`);
  return getBeatDetectionEngine().analyzeFromBlob(blob);
}
