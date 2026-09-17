import {
  audioBufferToMonoSamples,
  type MulticamTranscriptSegment,
} from "@openreel/core";

interface SherpaCue {
  text: string;
  startMs: number;
  endMs: number;
}

export function sherpaCuesToMulticamTranscript(
  cues: readonly SherpaCue[],
): MulticamTranscriptSegment[] {
  return cues.flatMap((cue) => {
    const text = cue.text.trim();
    if (!text) return [];
    const startMs = Math.max(0, Math.round(cue.startMs));
    const endMs = Math.max(startMs, Math.round(cue.endMs || startMs + 3_000));
    return [{ text, startMs, endMs }];
  });
}

export async function transcribeMulticamChannels(
  buffers: ReadonlyMap<string, AudioBuffer>,
  options: {
    onStatus?: (angleId: string, message: string) => void;
  } = {},
): Promise<Record<string, MulticamTranscriptSegment[]>> {
  const lunaMedia = window.openreel?.lunaMedia;
  if (typeof lunaMedia?.transcribeAudioSamples !== "function") {
    throw new Error("Native Sherpa transcription is unavailable in this editor.");
  }

  const transcripts: Record<string, MulticamTranscriptSegment[]> = {};
  for (const [angleId, buffer] of buffers) {
    options.onStatus?.(angleId, "Preparing native Sherpa transcription…");
    const result = await lunaMedia.transcribeAudioSamples(
      audioBufferToMonoSamples(buffer),
    );
    transcripts[angleId] = sherpaCuesToMulticamTranscript(result.cues);
    options.onStatus?.(angleId, "Native Sherpa transcription complete");
  }
  return transcripts;
}
