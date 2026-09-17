import type { Subtitle, SubtitleStyle } from "../types/timeline";
import { audioBufferToMonoSamples } from "../audio/audio-samples";

interface NativeSherpaResult {
  cues: Array<{
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

interface NativeTranscriptionApi {
  transcribeAudioSamples: (
    samples: Float32Array,
    options?: { chunkDurationSec?: number; overlapSec?: number },
  ) => Promise<NativeSherpaResult>;
}

interface OpenReelWindow {
  openreel?: {
    lunaMedia?: NativeTranscriptionApi;
  };
}

export interface TranscriptionSegment {
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly confidence: number;
}

export interface TranscriptionResult {
  readonly success: boolean;
  readonly segments: TranscriptionSegment[];
  readonly error?: string;
  readonly language?: string;
}

export interface SpeechToTextOptions {
  readonly language: string;
  readonly continuous: boolean;
  readonly interimResults: boolean;
  readonly maxAlternatives: number;
}

export type TranscriptionStatus =
  | "idle"
  | "preparing"
  | "transcribing"
  | "completed"
  | "error";

export interface TranscriptionProgress {
  readonly status: TranscriptionStatus;
  readonly progress: number;
  readonly currentTime: number;
  readonly totalDuration: number;
  readonly segmentsFound: number;
}

type ProgressCallback = (progress: TranscriptionProgress) => void;
type SegmentCallback = (segment: TranscriptionSegment) => void;

const SUPPORTED_LANGUAGES = [
  { code: "zh-CN", name: "Chinese (Simplified)" },
];

const DEFAULT_OPTIONS: SpeechToTextOptions = {
  language: "zh-CN",
  continuous: true,
  interimResults: false,
  maxAlternatives: 1,
};

const NATIVE_LANGUAGE = "zh-CN";

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  position: "bottom",
};

function getNativeTranscriptionApi(): NativeTranscriptionApi | null {
  if (typeof window === "undefined") return null;
  const media = (window as Window & OpenReelWindow).openreel?.lunaMedia;
  return typeof media?.transcribeAudioSamples === "function" ? media : null;
}

function segmentsFromCues(
  cues: NativeSherpaResult["cues"],
  sourceOffset: number,
  sourceDuration: number,
): TranscriptionSegment[] {
  return cues.flatMap((cue) => {
    const text = cue.text.trim();
    if (!text) return [];
    const start = Math.max(0, cue.startMs / 1_000);
    const end = Math.min(sourceDuration, Math.max(start, cue.endMs / 1_000));
    if (end <= start) return [];
    return [{
      text,
      startTime: sourceOffset + start,
      endTime: sourceOffset + end,
      confidence: 1,
    }];
  });
}

export class SpeechToTextEngine {
  private segments: TranscriptionSegment[] = [];
  private isTranscribing = false;
  private currentOptions: SpeechToTextOptions = DEFAULT_OPTIONS;
  private progressCallback: ProgressCallback | null = null;
  private segmentCallback: SegmentCallback | null = null;
  private liveRecorder: MediaRecorder | null = null;
  private liveStream: MediaStream | null = null;
  private liveChunks: Blob[] = [];

  static isSupported(): boolean {
    return typeof window !== "undefined" && Boolean(getNativeTranscriptionApi());
  }

  static getSupportedLanguages(): Array<{ code: string; name: string }> {
    return [...SUPPORTED_LANGUAGES];
  }

  private reportProgress(
    status: TranscriptionStatus,
    currentTime = 0,
    totalDuration = 0,
  ): void {
    this.progressCallback?.({
      status,
      progress: status === "completed" ? 100 : status === "error" ? 0 : 50,
      currentTime,
      totalDuration,
      segmentsFound: this.segments.length,
    });
  }

  private async transcribeSamples(
    samples: Float32Array,
    sourceOffset: number,
    sourceDuration: number,
  ): Promise<TranscriptionResult> {
    const nativeApi = getNativeTranscriptionApi();
    if (!nativeApi) throw new Error("Native Sherpa transcription is unavailable in this editor.");

    this.reportProgress("preparing", sourceOffset, sourceDuration);
    const result = await nativeApi.transcribeAudioSamples(samples);
    const segments = segmentsFromCues(result.cues, sourceOffset, sourceDuration);
    this.segments = segments;
    for (const segment of segments) this.segmentCallback?.(segment);
    this.reportProgress("completed", sourceOffset + sourceDuration, sourceDuration);
    return { success: true, segments: [...segments], language: NATIVE_LANGUAGE };
  }

  setOptions(options: Partial<SpeechToTextOptions>): void {
    this.currentOptions = { ...this.currentOptions, ...options };
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  onSegment(callback: SegmentCallback): void {
    this.segmentCallback = callback;
  }

  async startLiveTranscription(): Promise<void> {
    if (!SpeechToTextEngine.isSupported() ||
      typeof MediaRecorder === "undefined" ||
      typeof navigator.mediaDevices?.getUserMedia !== "function") {
      throw new Error("Native Sherpa transcription is unavailable in this editor.");
    }
    if (this.isTranscribing) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    this.segments = [];
    this.liveChunks = [];
    this.liveStream = stream;
    this.liveRecorder = recorder;
    this.isTranscribing = true;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.liveChunks.push(event.data);
    };
    recorder.onerror = () => {
      this.isTranscribing = false;
      this.reportProgress("error");
    };
    recorder.onstop = () => {
      void this.finishLiveTranscription();
    };
    this.reportProgress("transcribing");
    recorder.start();
  }

  private async finishLiveTranscription(): Promise<void> {
    const chunks = this.liveChunks;
    this.liveChunks = [];
    this.liveRecorder = null;
    this.liveStream?.getTracks().forEach((track) => track.stop());
    this.liveStream = null;
    if (chunks.length === 0) {
      this.isTranscribing = false;
      this.reportProgress("completed");
      return;
    }

    let audioContext: AudioContext | null = null;
    try {
      audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(
        await new Blob(chunks).arrayBuffer(),
      );
      this.isTranscribing = true;
      await this.transcribeSamples(
        audioBufferToMonoSamples(audioBuffer),
        0,
        audioBuffer.duration,
      );
    } catch (error) {
      this.reportProgress("error");
      console.error("Native Sherpa live transcription failed:", error);
    } finally {
      await audioContext?.close().catch(() => undefined);
      this.isTranscribing = false;
    }
  }

  stopTranscription(): TranscriptionResult {
    if (!this.isTranscribing) {
      return {
        success: true,
        segments: this.segments,
        language: NATIVE_LANGUAGE,
      };
    }

    const recorder = this.liveRecorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      this.reportProgress("preparing");
    } else {
      this.isTranscribing = false;
      this.reportProgress("completed");
    }

    return {
      success: true,
      segments: [...this.segments],
      language: NATIVE_LANGUAGE,
    };
  }

  async transcribeAudioElement(
    audioElement: HTMLAudioElement | HTMLVideoElement,
    startOffset = 0,
    duration?: number,
  ): Promise<TranscriptionResult> {
    if (!getNativeTranscriptionApi()) {
      return {
        success: false,
        segments: [],
        error: "Native Sherpa transcription is unavailable in this editor.",
      };
    }

    let audioContext: AudioContext | null = null;
    this.segments = [];
    this.isTranscribing = true;
    try {
      const source = audioElement.currentSrc || audioElement.src;
      if (!source) throw new Error("The selected media has no readable audio source.");
      const response = await fetch(source);
      if (!response.ok) throw new Error("The selected media could not be read.");
      audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
      const start = Math.max(0, Math.min(audioBuffer.duration, startOffset));
      const end = Math.min(
        audioBuffer.duration,
        duration === undefined ? audioBuffer.duration : start + Math.max(0, duration),
      );
      if (end <= start) throw new Error("The selected media has no audio range.");
      return await this.transcribeSamples(
        audioBufferToMonoSamples(audioBuffer, start, end),
        start,
        end - start,
      );
    } catch (error) {
      this.reportProgress("error");
      return {
        success: false,
        segments: [],
        error: error instanceof Error ? error.message : "Native Sherpa transcription failed.",
      };
    } finally {
      await audioContext?.close().catch(() => undefined);
      this.isTranscribing = false;
    }
  }

  segmentsToSubtitles(
    segments: TranscriptionSegment[],
    style?: Partial<SubtitleStyle>,
  ): Subtitle[] {
    const subtitleStyle: SubtitleStyle = {
      ...DEFAULT_SUBTITLE_STYLE,
      ...style,
    };

    return segments.map((segment, index) => ({
      id: `auto-caption-${Date.now()}-${index}`,
      text: segment.text,
      startTime: segment.startTime,
      endTime: segment.endTime,
      style: subtitleStyle,
    }));
  }

  getSegments(): TranscriptionSegment[] {
    return [...this.segments];
  }

  clearSegments(): void {
    this.segments = [];
  }

  isActive(): boolean {
    return this.isTranscribing;
  }

  dispose(): void {
    const recorder = this.liveRecorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.liveStream?.getTracks().forEach((track) => track.stop());
    this.liveRecorder = null;
    this.liveStream = null;
    this.liveChunks = [];
    this.isTranscribing = false;
    this.progressCallback = null;
    this.segmentCallback = null;
  }
}

export const createSpeechToTextEngine = (): SpeechToTextEngine => {
  return new SpeechToTextEngine();
};
