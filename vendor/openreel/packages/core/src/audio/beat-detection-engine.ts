import {
  BeatDetectionProcessor,
  getBeatDetectionProcessor,
  initWasmBeatDetection,
} from "../wasm/beat-detection";

export interface Beat {
  readonly time: number;
  readonly strength: number;
  readonly index: number;
}

export interface BeatAnalysisResult {
  readonly bpm: number;
  readonly confidence: number;
  readonly beats: Beat[];
  readonly duration: number;
  readonly downbeats: number[];
}

export interface BeatDetectionConfig {
  readonly minBpm: number;
  readonly maxBpm: number;
  readonly sensitivity: number;
  readonly windowSize: number;
  readonly hopSize: number;
}

export const DEFAULT_BEAT_DETECTION_CONFIG: BeatDetectionConfig = {
  minBpm: 60,
  maxBpm: 200,
  sensitivity: 0.5,
  windowSize: 2048,
  hopSize: 512,
};

export class BeatDetectionEngine {
  private config: BeatDetectionConfig;
  private audioContext: AudioContext | OfflineAudioContext | null = null;
  private wasmProcessor: BeatDetectionProcessor;
  private wasmInitialized: boolean = false;

  constructor(config: Partial<BeatDetectionConfig> = {}) {
    this.config = { ...DEFAULT_BEAT_DETECTION_CONFIG, ...config };
    this.wasmProcessor = getBeatDetectionProcessor();
    this.initWasm();
  }

  private async initWasm(): Promise<void> {
    if (this.wasmInitialized) return;
    try {
      await initWasmBeatDetection();
      await this.wasmProcessor.ensureWasm();
      this.wasmInitialized = true;
    } catch {
      this.wasmInitialized = false;
    }
  }

  async analyzeAudioBuffer(
    audioBuffer: AudioBuffer,
  ): Promise<BeatAnalysisResult> {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    const onsets = this.detectOnsets(channelData, sampleRate);
    const { bpm, confidence } = this.calculateBpm(onsets, duration);
    // An undetected tempo must not turn into a convincing-looking 120 BPM grid.
    const beats = confidence > 0 ? this.generateBeats(bpm, duration, onsets) : [];
    const downbeats = this.detectDownbeats(beats);

    return {
      bpm,
      confidence,
      beats,
      duration,
      downbeats,
    };
  }

  async analyzeFromBlob(blob: Blob): Promise<BeatAnalysisResult> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.analyzeAudioBuffer(audioBuffer);
  }

  async analyzeFromUrl(url: string): Promise<BeatAnalysisResult> {
    const response = await fetch(url);
    const blob = await response.blob();
    return this.analyzeFromBlob(blob);
  }

  /**
   * Detects onset events (significant energy increases) in audio using RMS energy analysis.
   * Algorithm: Extract RMS energy in windows, smooth for stability, apply adaptive threshold,
   * find peaks (local maxima with sufficient rise), enforce minimum spacing between detections.
   *
   * This is more robust than spectral methods for real-world audio with variable dynamics.
   */
  private detectOnsets(samples: Float32Array, sampleRate: number): number[] {
    const { windowSize, hopSize, sensitivity } = this.config;
    const onsets: number[] = [];

    const numFrames = Math.max(0, 1 + Math.floor((samples.length - windowSize) / hopSize));
    if (numFrames < 3) return [];
    const energiesF32 = new Float32Array(numFrames);

    this.wasmProcessor.computeRMSEnergies(samples, windowSize, hopSize, energiesF32);

    const smoothedF32 = new Float32Array(numFrames);
    this.wasmProcessor.smoothArray(energiesF32, smoothedF32, 3);

    // Measure attacks above the recent energy floor. A sustained pad must not
    // hide percussion, and the small slope at an energy peak is not its attack.
    const novelty = Array.from(smoothedF32, (energy, index) =>
      Math.max(0, energy - smoothedF32[Math.max(0, index - 3)]),
    );
    const energyFloor = smoothedF32.reduce((peak, energy) => Math.max(peak, energy), 0) * 0.01;
    // Step 3: Compute dynamic threshold based on local statistics and sensitivity
    const threshold = this.calculateAdaptiveThreshold(
      novelty,
      sensitivity,
    );

    // Step 4: Detect peaks (onsets) with multiple constraints
    let lastOnsetFrame = -Infinity;
    // Minimum 100ms between onsets to avoid detecting echoes/reverb as separate onsets
    const minFramesBetweenOnsets = Math.floor((sampleRate / hopSize) * 0.1);

    for (let i = 1; i < novelty.length - 1; i++) {
      const current = novelty[i];
      const localThreshold = Math.max(energyFloor, threshold[i]);

      // Must be local maximum in time
      const isLocalMax =
        current > novelty[i - 1] && current >= novelty[i + 1];
      // Must exceed adaptive threshold at this point
      const isAboveThreshold = current > localThreshold;
      // Enforce minimum spacing between detections (prevents duplicate detections)
      const notTooClose = i - lastOnsetFrame >= minFramesBetweenOnsets;

      if (isLocalMax && isAboveThreshold && notTooClose) {
        const timeInSeconds = (i * hopSize + windowSize / 2) / sampleRate;
        onsets.push(timeInSeconds);
        lastOnsetFrame = i;
      }
    }

    return onsets;
  }

  /**
   * Computes per-frame dynamic thresholds using local statistics.
   * Combines median (robust to outliers) and mean (captures overall level).
   * Sensitivity parameter: 0 (strict, few false positives) to 1 (loose, more detections).
   * Local context window accounts for audio dynamics (e.g., quiet intro vs loud chorus).
   */
  private calculateAdaptiveThreshold(
    energies: number[],
    sensitivity: number,
  ): number[] {
    const medianWindowSize = 50;
    const thresholds: number[] = [];

    for (let i = 0; i < energies.length; i++) {
      const start = Math.max(0, i - medianWindowSize);
      const end = Math.min(energies.length, i + medianWindowSize);
      const windowArr = new Float32Array(energies.slice(start, end));

      const median = this.wasmProcessor.calculateMedian(windowArr);
      const mean = this.wasmProcessor.calculateMean(windowArr);

      const threshold = median + (mean - median) * (1 - sensitivity);
      thresholds.push(threshold * (1.5 - sensitivity * 0.5));
    }

    return thresholds;
  }

  private calculateBpm(
    onsets: number[],
    duration: number,
  ): { bpm: number; confidence: number } {
    if (onsets.length < 4) {
      return { bpm: 120, confidence: 0 };
    }

    const { minBpm, maxBpm } = this.config;
    const bpmCandidates = new Map<number, number>();
    // Eighth-note hats and missing attacks are common. Include nearby onset
    // pairs instead of discarding every interval shorter than one full beat.
    for (let index = 0; index < onsets.length; index++) {
      for (let gap = 1; gap <= 4 && index + gap < onsets.length; gap++) {
        const interval = onsets[index + gap] - onsets[index];
        if (interval <= 0) continue;
        for (const [multiple, weight] of [[1, 1], [0.5, 0.5], [2, 0.3]]) {
          const candidate = Math.round(60 * multiple / interval);
          if (candidate >= minBpm && candidate <= maxBpm) {
            bpmCandidates.set(candidate, (bpmCandidates.get(candidate) ?? 0) + weight / gap);
          }
        }
      }
    }

    let bestBpm = 120;
    let bestScore = 0;

    for (const [bpm, score] of bpmCandidates) {
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }

    if (bestScore === 0) return { bpm: 120, confidence: 0 };
    const period = 60 / bestBpm;
    const coveredBeats = new Set<number>();
    const phase = onsets[0] % period;
    for (const onset of onsets) {
      const index = Math.round((onset - phase) / period);
      if (Math.abs(onset - (phase + index * period)) <= period * 0.12) coveredBeats.add(index);
    }
    const expectedBeats = Math.max(1, Math.ceil((duration - phase) / period));
    const confidence = Math.min(1, coveredBeats.size / expectedBeats);

    return { bpm: bestBpm, confidence };
  }

  private generateBeats(
    bpm: number,
    duration: number,
    onsets: number[],
  ): Beat[] {
    const beatInterval = 60 / bpm;
    const beats: Beat[] = [];

    let firstBeatTime = 0;
    if (onsets.length > 0) {
      const firstOnset = onsets[0];
      const offsetBeats = Math.round(firstOnset / beatInterval);
      firstBeatTime = firstOnset - offsetBeats * beatInterval;
      while (firstBeatTime < 0) firstBeatTime += beatInterval;
    }

    let beatIndex = 0;
    for (let time = firstBeatTime; time < duration; time += beatInterval) {
      const nearestOnset = this.findNearestOnset(
        time,
        onsets,
        beatInterval * 0.3,
      );
      const strength = nearestOnset !== null ? 1 : 0.5;

      beats.push({
        time: nearestOnset !== null ? nearestOnset : time,
        strength,
        index: beatIndex,
      });

      beatIndex++;
    }

    return beats;
  }

  private findNearestOnset(
    time: number,
    onsets: number[],
    tolerance: number,
  ): number | null {
    let nearest: number | null = null;
    let minDist = tolerance;

    for (const onset of onsets) {
      const dist = Math.abs(onset - time);
      if (dist < minDist) {
        minDist = dist;
        nearest = onset;
      }
    }

    return nearest;
  }

  private detectDownbeats(beats: Beat[]): number[] {
    if (beats.length < 4) {
      return beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
    }

    const downbeats: number[] = [];
    const strongBeats = beats.filter((b) => b.strength > 0.7);

    if (strongBeats.length > 0) {
      const firstStrong = strongBeats[0];
      const firstIndex = beats.findIndex((b) => b.time === firstStrong.time);

      for (let i = firstIndex; i < beats.length; i += 4) {
        downbeats.push(beats[i].time);
      }
    } else {
      for (let i = 0; i < beats.length; i += 4) {
        downbeats.push(beats[i].time);
      }
    }

    return downbeats;
  }

  generateBeatMarkersAtInterval(
    bpm: number,
    duration: number,
    startTime: number = 0,
    beatsPerBar: number = 4,
  ): Beat[] {
    const beatInterval = 60 / bpm;
    const beats: Beat[] = [];
    let beatIndex = 0;

    for (let time = startTime; time < duration; time += beatInterval) {
      const isDownbeat = beatIndex % beatsPerBar === 0;
      beats.push({
        time,
        strength: isDownbeat ? 1 : 0.7,
        index: beatIndex,
      });
      beatIndex++;
    }

    return beats;
  }

  snapTimeToNearestBeat(
    time: number,
    beats: Beat[],
    snapThreshold: number = 0.1,
  ): number {
    if (beats.length === 0) return time;

    let nearest = beats[0];
    let minDist = Math.abs(beats[0].time - time);

    for (const beat of beats) {
      const dist = Math.abs(beat.time - time);
      if (dist < minDist) {
        minDist = dist;
        nearest = beat;
      }
    }

    return minDist <= snapThreshold ? nearest.time : time;
  }

  getBeatsInRange(beats: Beat[], startTime: number, endTime: number): Beat[] {
    return beats.filter((b) => b.time >= startTime && b.time <= endTime);
  }

  dispose(): void {
    if (this.audioContext && this.audioContext instanceof AudioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

let beatDetectionEngineInstance: BeatDetectionEngine | null = null;

export function getBeatDetectionEngine(): BeatDetectionEngine {
  if (!beatDetectionEngineInstance) {
    beatDetectionEngineInstance = new BeatDetectionEngine();
  }
  return beatDetectionEngineInstance;
}

export function disposeBeatDetectionEngine(): void {
  if (beatDetectionEngineInstance) {
    beatDetectionEngineInstance.dispose();
    beatDetectionEngineInstance = null;
  }
}
