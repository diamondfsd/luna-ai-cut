import type {
  AudioEngine,
  Clip,
  AutomationPoint,
  Effect,
} from "@openreel/core";
import { AudioEffectsEngine, getAudioEffectsEngine } from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 4;

export const PAN_MIN = -1;
export const PAN_MAX = 1;

export function clampVolume(volume: number): number {
  return Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, volume));
}

export function clampPan(pan: number): number {
  return Math.max(PAN_MIN, Math.min(PAN_MAX, pan));
}

export function applyVolume(amplitude: number, volume: number): number {
  const clampedVolume = clampVolume(volume);
  return amplitude * clampedVolume;
}

export function calculatePanGains(pan: number): {
  left: number;
  right: number;
} {
  const clampedPan = clampPan(pan);
  const normalizedPan = (clampedPan + 1) / 2;
  const angle = normalizedPan * (Math.PI / 2);

  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  };
}

export function applyPan(
  leftSample: number,
  rightSample: number,
  pan: number,
): { left: number; right: number } {
  const gains = calculatePanGains(pan);
  const monoMix = (leftSample + rightSample) / 2;

  return {
    left: monoMix * gains.left * Math.sqrt(2),
    right: monoMix * gains.right * Math.sqrt(2),
  };
}

/**
 * Interpolate volume between automation points
 *
 * Interpolate volume between automation points during playback
 * Feature: core-ui-integration, Property 19: Volume Automation Interpolation
 *
 * @param time - Current time in seconds
 * @param automationPoints - Array of automation points sorted by time
 * @param baseVolume - Base volume to use if no automation points
 * @returns Interpolated volume value (clamped to 0-4)
 */
export function interpolateVolume(
  time: number,
  automationPoints: AutomationPoint[],
  baseVolume: number = 1,
): number {
  // If no automation points, return base volume
  if (!automationPoints || automationPoints.length === 0) {
    return clampVolume(baseVolume);
  }

  // Sort points by time (defensive copy)
  const sortedPoints = [...automationPoints].sort((a, b) => a.time - b.time);

  // Before first point - use first point's value
  if (time <= sortedPoints[0].time) {
    return clampVolume(sortedPoints[0].value);
  }

  // After last point - use last point's value
  if (time >= sortedPoints[sortedPoints.length - 1].time) {
    return clampVolume(sortedPoints[sortedPoints.length - 1].value);
  }

  // Find surrounding points and interpolate
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const current = sortedPoints[i];
    const next = sortedPoints[i + 1];

    if (time >= current.time && time < next.time) {
      // Linear interpolation between points
      const t = (time - current.time) / (next.time - current.time);
      const interpolatedValue =
        current.value + t * (next.value - current.value);
      return clampVolume(interpolatedValue);
    }
  }

  // Fallback (should not reach here)
  return clampVolume(baseVolume);
}

/**
 * Interpolate pan between automation points
 *
 * @param time - Current time in seconds
 * @param automationPoints - Array of automation points sorted by time
 * @param basePan - Base pan to use if no automation points
 * @returns Interpolated pan value (clamped to -1 to 1)
 */
export function interpolatePan(
  time: number,
  automationPoints: AutomationPoint[],
  basePan: number = 0,
): number {
  // If no automation points, return base pan
  if (!automationPoints || automationPoints.length === 0) {
    return clampPan(basePan);
  }

  // Sort points by time (defensive copy)
  const sortedPoints = [...automationPoints].sort((a, b) => a.time - b.time);

  // Before first point - use first point's value
  if (time <= sortedPoints[0].time) {
    return clampPan(sortedPoints[0].value);
  }

  // After last point - use last point's value
  if (time >= sortedPoints[sortedPoints.length - 1].time) {
    return clampPan(sortedPoints[sortedPoints.length - 1].value);
  }

  // Find surrounding points and interpolate
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const current = sortedPoints[i];
    const next = sortedPoints[i + 1];

    if (time >= current.time && time < next.time) {
      // Linear interpolation between points
      const t = (time - current.time) / (next.time - current.time);
      const interpolatedValue =
        current.value + t * (next.value - current.value);
      return clampPan(interpolatedValue);
    }
  }

  // Fallback (should not reach here)
  return clampPan(basePan);
}

/**
 * Get effective volume for a clip at a specific time
 *
 * Combines base clip volume with automation if present.
 *
 * Apply volume with automation support
 * Feature: core-ui-integration, Property 17, Property 19
 *
 * @param clip - The clip to get volume for
 * @param timeInClip - Time relative to clip start
 * @returns Effective volume value (0-4)
 */
export function getClipVolumeAtTime(clip: Clip, timeInClip: number): number {
  const baseVolume = clip.volume;
  const automationPoints = clip.automation?.volume;

  if (!automationPoints || automationPoints.length === 0) {
    return clampVolume(baseVolume);
  }

  // Interpolate automation and multiply by base volume
  const automatedVolume = interpolateVolume(timeInClip, automationPoints, 1);
  return clampVolume(baseVolume * automatedVolume);
}

/**
 * Get effective pan for a clip at a specific time
 *
 * Uses automation if present, otherwise returns base pan from effects.
 *
 * Apply stereo positioning
 * Feature: core-ui-integration, Property 18
 *
 * @param clip - The clip to get pan for
 * @param timeInClip - Time relative to clip start
 * @returns Effective pan value (-1 to 1)
 */
export function getClipPanAtTime(clip: Clip, timeInClip: number): number {
  // Get base pan from effects
  const panEffect = clip.effects.find((e) => e.type === "pan");
  const basePan =
    panEffect && typeof panEffect.params.value === "number"
      ? panEffect.params.value
      : 0;

  const automationPoints = clip.automation?.pan;

  if (!automationPoints || automationPoints.length === 0) {
    return clampPan(basePan);
  }

  // Use automation value directly (not multiplied like volume)
  return interpolatePan(timeInClip, automationPoints, basePan);
}

/**
 * AudioBridge class for connecting UI state to core audio processing
 */
export class AudioBridge {
  private audioEngine: AudioEngine | null = null;
  private initialized = false;

  /**
   * Initialize the audio bridge
   * Connects to the AudioEngine from the engine store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const engineState = useEngineStore.getState();

    if (!engineState.initialized) {
      throw new Error("EngineStore must be initialized before AudioBridge");
    }

    this.audioEngine = engineState.audioEngine;

    if (!this.audioEngine) {
      throw new Error("AudioEngine not available in EngineStore");
    }

    this.initialized = true;
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the audio engine instance
   */
  getAudioEngine(): AudioEngine | null {
    return this.audioEngine;
  }

  /**
   * Get volume at a specific time for a clip
   *
   * Get effective volume with automation
   * Feature: core-ui-integration, Property 17, Property 19
   *
   * @param clipId - ID of the clip
   * @param timeInClip - Time relative to clip start
   * @returns Effective volume value (0-4)
   */
  getVolumeAtTime(clipId: string, timeInClip: number): number {
    const projectStore = useProjectStore.getState();
    const clip = projectStore.getClip(clipId);

    if (clip) {
      return getClipVolumeAtTime(clip, timeInClip);
    }

    // Clip not found, return unity gain
    return 1;
  }

  /**
   * Get pan at a specific time for a clip
   *
   * Get effective pan
   * Feature: core-ui-integration, Property 18
   *
   * @param clipId - ID of the clip
   * @param timeInClip - Time relative to clip start
   * @returns Effective pan value (-1 to 1)
   */
  getPanAtTime(clipId: string, timeInClip: number): number {
    const projectStore = useProjectStore.getState();
    const clip = projectStore.getClip(clipId);

    if (clip) {
      return getClipPanAtTime(clip, timeInClip);
    }

    // Clip not found, return center
    return 0;
  }

  /**
   * Calculate the effective audio parameters for a clip at a given time
   *
   * Get all audio parameters
   * Feature: core-ui-integration, Property 17, Property 18, Property 19
   *
   * @param clipId - ID of the clip
   * @param timeInClip - Time relative to clip start
   * @returns Object with volume and pan values
   */
  getAudioParamsAtTime(
    clipId: string,
    timeInClip: number,
  ): { volume: number; pan: number } {
    return {
      volume: this.getVolumeAtTime(clipId, timeInClip),
      pan: this.getPanAtTime(clipId, timeInClip),
    };
  }

  /**
   * Dispose of the audio bridge and clean up resources
   */
  dispose(): void {
    this.audioEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let audioBridgeInstance: AudioBridge | null = null;

/**
 * Get the shared AudioBridge instance
 */
export function getAudioBridge(): AudioBridge {
  if (!audioBridgeInstance) {
    audioBridgeInstance = new AudioBridge();
  }
  return audioBridgeInstance;
}

/**
 * Initialize the shared AudioBridge
 */
export async function initializeAudioBridge(): Promise<AudioBridge> {
  const bridge = getAudioBridge();
  await bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared AudioBridge
 */
export function disposeAudioBridge(): void {
  if (audioBridgeInstance) {
    audioBridgeInstance.dispose();
    audioBridgeInstance = null;
  }
}

// ============================================================================
// Audio Enhancement Types and Functions
// Feature: core-ui-integration, Property 40: Audio Effect Processing
// ============================================================================

/**
 * Audio enhancement effect types
 */
export type AudioEnhancementType =
  | "noiseReduction"
  | "speechEnhancement"
  | "normalization"
  | "eq";

/**
 * Noise reduction parameters
 * Apply noise reduction to reduce background noise
 */
export interface NoiseReductionParams {
  /** Threshold in dB below which audio is considered noise (-60 to 0) */
  threshold: number;
  /** Amount of reduction to apply (0 to 1) */
  reduction: number;
  /** Attack time in milliseconds (0 to 100) */
  attack?: number;
  /** Release time in milliseconds (0 to 500) */
  release?: number;
}

/**
 * Speech enhancement parameters
 * Apply speech enhancement to boost vocal frequencies
 */
export interface SpeechEnhancementParams {
  /** Amount of vocal frequency boost (0 to 1) */
  clarity: number;
  /** De-essing amount to reduce sibilance (0 to 1) */
  deEss?: number;
  /** Presence boost for intelligibility (0 to 1) */
  presence?: number;
}

/**
 * Normalization parameters
 * Apply audio normalization to adjust levels
 */
export interface NormalizationParams {
  /** Target loudness in LUFS (-24 to 0) */
  targetLoudness: number;
  /** Peak ceiling in dB (-6 to 0) */
  peakCeiling?: number;
  /** Enable true peak limiting */
  truePeak?: boolean;
}

/**
 * EQ band definition
 * Apply EQ to adjust frequency bands
 */
export interface EQBandParams {
  /** Filter type */
  type: "lowshelf" | "highshelf" | "peaking" | "lowpass" | "highpass" | "notch";
  /** Center frequency in Hz (20 to 20000) */
  frequency: number;
  /** Gain in dB (-24 to 24) */
  gain: number;
  /** Q factor (0.1 to 18) */
  q: number;
}

/**
 * EQ parameters
 * Apply EQ to adjust frequency bands
 */
export interface EQParams {
  /** Array of EQ bands */
  bands: EQBandParams[];
}

/**
 * Audio enhancement result
 */
export interface AudioEnhancementResult {
  /** Whether the effect was applied successfully */
  success: boolean;
  /** List of effects that were applied */
  appliedEffects: AudioEnhancementType[];
  /** Error message if any */
  error?: string;
}

/**
 * Default noise reduction parameters
 */
export const DEFAULT_NOISE_REDUCTION: NoiseReductionParams = {
  threshold: -40,
  reduction: 0.5,
  attack: 10,
  release: 100,
};

/**
 * Default speech enhancement parameters
 */
export const DEFAULT_SPEECH_ENHANCEMENT: SpeechEnhancementParams = {
  clarity: 0.5,
  deEss: 0.3,
  presence: 0.4,
};

/**
 * Default normalization parameters
 */
export const DEFAULT_NORMALIZATION: NormalizationParams = {
  targetLoudness: -14,
  peakCeiling: -1,
  truePeak: true,
};

/**
 * Validate noise reduction parameters
 *
 * Ensure valid noise reduction parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Noise reduction parameters to validate
 * @returns Validated and clamped parameters
 */
export function validateNoiseReductionParams(
  params: Partial<NoiseReductionParams>,
): NoiseReductionParams {
  return {
    threshold: Math.max(
      -60,
      Math.min(0, params.threshold ?? DEFAULT_NOISE_REDUCTION.threshold),
    ),
    reduction: Math.max(
      0,
      Math.min(1, params.reduction ?? DEFAULT_NOISE_REDUCTION.reduction),
    ),
    attack: Math.max(
      0,
      Math.min(100, params.attack ?? DEFAULT_NOISE_REDUCTION.attack!),
    ),
    release: Math.max(
      0,
      Math.min(500, params.release ?? DEFAULT_NOISE_REDUCTION.release!),
    ),
  };
}

/**
 * Validate speech enhancement parameters
 *
 * Ensure valid speech enhancement parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Speech enhancement parameters to validate
 * @returns Validated and clamped parameters
 */
export function validateSpeechEnhancementParams(
  params: Partial<SpeechEnhancementParams>,
): SpeechEnhancementParams {
  return {
    clarity: Math.max(
      0,
      Math.min(1, params.clarity ?? DEFAULT_SPEECH_ENHANCEMENT.clarity),
    ),
    deEss: Math.max(
      0,
      Math.min(1, params.deEss ?? DEFAULT_SPEECH_ENHANCEMENT.deEss!),
    ),
    presence: Math.max(
      0,
      Math.min(1, params.presence ?? DEFAULT_SPEECH_ENHANCEMENT.presence!),
    ),
  };
}

/**
 * Validate normalization parameters
 *
 * Ensure valid normalization parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Normalization parameters to validate
 * @returns Validated and clamped parameters
 */
export function validateNormalizationParams(
  params: Partial<NormalizationParams>,
): NormalizationParams {
  return {
    targetLoudness: Math.max(
      -24,
      Math.min(
        0,
        params.targetLoudness ?? DEFAULT_NORMALIZATION.targetLoudness,
      ),
    ),
    peakCeiling: Math.max(
      -6,
      Math.min(0, params.peakCeiling ?? DEFAULT_NORMALIZATION.peakCeiling!),
    ),
    truePeak: params.truePeak ?? DEFAULT_NORMALIZATION.truePeak!,
  };
}

/**
 * Validate EQ band parameters
 *
 * Ensure valid EQ parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param band - EQ band parameters to validate
 * @returns Validated and clamped band parameters
 */
export function validateEQBand(band: Partial<EQBandParams>): EQBandParams {
  const validTypes: EQBandParams["type"][] = [
    "lowshelf",
    "highshelf",
    "peaking",
    "lowpass",
    "highpass",
    "notch",
  ];
  const type = validTypes.includes(band.type as EQBandParams["type"])
    ? (band.type as EQBandParams["type"])
    : "peaking";

  return {
    type,
    frequency: Math.max(20, Math.min(20000, band.frequency ?? 1000)),
    gain: Math.max(-24, Math.min(24, band.gain ?? 0)),
    q: Math.max(0.1, Math.min(18, band.q ?? 1)),
  };
}

/**
 * Validate EQ parameters
 *
 * Ensure valid EQ parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - EQ parameters to validate
 * @returns Validated EQ parameters with clamped bands
 */
export function validateEQParams(params: Partial<EQParams>): EQParams {
  const bands = params.bands ?? [];
  return {
    bands: bands.map(validateEQBand),
  };
}

/**
 * Create a noise reduction effect
 *
 * Apply noise reduction to reduce background noise
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Noise reduction parameters
 * @returns Effect object for noise reduction
 */
export function createNoiseReductionEffect(
  params: Partial<NoiseReductionParams> = {},
): Effect {
  const validated = validateNoiseReductionParams(params);
  return {
    id: `noise-reduction-${Date.now()}`,
    type: "noiseReduction",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Create a speech enhancement effect using EQ bands
 *
 * Apply speech enhancement to boost vocal frequencies
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * Speech enhancement is implemented using targeted EQ bands:
 * - Presence boost (2-4kHz) for clarity
 * - High-shelf for air/brightness
 * - Low-cut to remove rumble
 * - De-essing notch at 6-8kHz
 *
 * @param params - Speech enhancement parameters
 * @returns Effect object for speech enhancement
 */
export function createSpeechEnhancementEffect(
  params: Partial<SpeechEnhancementParams> = {},
): Effect {
  const validated = validateSpeechEnhancementParams(params);

  // Build EQ bands for speech enhancement
  const bands: EQBandParams[] = [
    // High-pass to remove low rumble
    {
      type: "highpass",
      frequency: 80,
      gain: 0,
      q: 0.707,
    },
    // Presence boost for clarity (2-4kHz range)
    {
      type: "peaking",
      frequency: 3000,
      gain: validated.clarity * 6, // Up to +6dB boost
      q: 1.5,
    },
    // Air/brightness boost
    {
      type: "highshelf",
      frequency: 8000,
      gain: validated.presence! * 4, // Up to +4dB boost
      q: 0.707,
    },
  ];

  // Add de-essing if enabled
  if (validated.deEss! > 0) {
    bands.push({
      type: "peaking",
      frequency: 6500,
      gain: -(validated.deEss! * 6), // Up to -6dB cut
      q: 3,
    });
  }

  return {
    id: `speech-enhancement-${Date.now()}`,
    type: "eq",
    params: { bands },
    enabled: true,
  };
}

/**
 * Create a normalization effect using compressor
 *
 * Apply audio normalization to adjust levels
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * Normalization is implemented using a compressor with makeup gain
 * to achieve target loudness while respecting peak ceiling.
 *
 * @param params - Normalization parameters
 * @returns Effect object for normalization
 */
export function createNormalizationEffect(
  params: Partial<NormalizationParams> = {},
): Effect {
  const validated = validateNormalizationParams(params);

  // Calculate compressor settings based on target loudness
  // Lower target loudness = more compression needed
  const compressionRatio = Math.max(
    2,
    Math.min(8, -validated.targetLoudness / 4),
  );
  const threshold = validated.targetLoudness + 6; // Threshold above target

  return {
    id: `normalization-${Date.now()}`,
    type: "compressor",
    params: {
      threshold: Math.max(-60, Math.min(0, threshold)),
      ratio: compressionRatio,
      attack: 0.01,
      release: 0.1,
      knee: 6,
      makeupGain: Math.abs(validated.targetLoudness) / 2,
    },
    enabled: true,
  };
}

/**
 * Create an EQ effect
 *
 * Apply EQ to adjust frequency bands
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - EQ parameters
 * @returns Effect object for EQ
 */
export function createEQEffect(params: Partial<EQParams> = {}): Effect {
  const validated = validateEQParams(params);
  return {
    id: `eq-${Date.now()}`,
    type: "eq",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Apply audio enhancement effects to an audio buffer
 *
 * Apply audio enhancement effects
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param buffer - Input audio buffer
 * @param effects - Array of effects to apply
 * @param audioEffectsEngine - Optional AudioEffectsEngine instance
 * @returns Processed audio buffer with applied effects
 */
export async function applyAudioEnhancements(
  buffer: AudioBuffer,
  effects: Effect[],
  audioEffectsEngine?: AudioEffectsEngine,
): Promise<AudioEnhancementResult & { buffer?: AudioBuffer }> {
  const engine = audioEffectsEngine ?? getAudioEffectsEngine();

  if (!engine.isInitialized()) {
    await engine.initialize();
  }

  const enabledEffects = effects.filter((e) => e.enabled);
  if (enabledEffects.length === 0) {
    return {
      success: true,
      appliedEffects: [],
      buffer,
    };
  }

  try {
    const result = await engine.applyEffectChain(buffer, enabledEffects);

    // Map effect types to enhancement types
    const appliedEffects: AudioEnhancementType[] = result.appliedEffects
      .map((type) => {
        switch (type) {
          case "noiseReduction":
            return "noiseReduction" as AudioEnhancementType;
          case "eq":
            return "eq" as AudioEnhancementType;
          case "compressor":
            return "normalization" as AudioEnhancementType;
          default:
            return null;
        }
      })
      .filter((t): t is AudioEnhancementType => t !== null);

    return {
      success: true,
      appliedEffects,
      buffer: result.buffer,
    };
  } catch (error) {
    return {
      success: false,
      appliedEffects: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if an effect is an audio enhancement effect
 *
 * @param effect - Effect to check
 * @returns True if the effect is an audio enhancement type
 */
export function isAudioEnhancementEffect(effect: Effect): boolean {
  const enhancementTypes = [
    "noiseReduction",
    "eq",
    "compressor",
    "reverb",
    "delay",
  ];
  return enhancementTypes.includes(effect.type);
}

/**
 * Get audio enhancement effects from a clip
 *
 * @param clip - Clip to get effects from
 * @returns Array of audio enhancement effects
 */
export function getClipAudioEnhancements(clip: Clip): Effect[] {
  return clip.effects.filter(isAudioEnhancementEffect);
}
