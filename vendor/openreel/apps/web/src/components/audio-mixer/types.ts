/**
 * Channel strip state for a single audio track
 */
export interface ChannelStripState {
  readonly trackId: string;
  readonly trackName: string;
  readonly trackType: "video" | "audio" | "image" | "text" | "graphics";
  readonly volume: number; // 0-4 (0 = -inf dB, 1 = 0dB, 4 = +12dB)
  readonly pan: number; // -1 (left) to 1 (right)
  readonly muted: boolean;
  readonly solo: boolean;
  readonly peakLevel: number; // 0-1 for meter display
  readonly rmsLevel: number; // 0-1 for meter display
}

/**
 * Audio mixer state
 */
export interface AudioMixerState {
  readonly channels: ChannelStripState[];
  readonly masterVolume: number;
  readonly masterPeakLevel: number;
  readonly masterRmsLevel: number;
}

/**
 * Volume to dB conversion
 * @param volume - Linear volume (0-4)
 * @returns dB value
 */
export function volumeToDb(volume: number): number {
  if (volume <= 0) return -Infinity;
  return 20 * Math.log10(volume);
}

/**
 * dB to volume conversion
 * @param db - dB value
 * @returns Linear volume (0-4)
 */
export function dbToVolume(db: number): number {
  if (db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Format dB value for display
 * @param db - dB value
 * @returns Formatted string
 */
export function formatDb(db: number): string {
  if (db === -Infinity || db < -60) return "-∞";
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)}`;
}

/**
 * Pan position labels
 */
export function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.05) return "C";
  if (pan < 0) return `L${Math.round(Math.abs(pan) * 100)}`;
  return `R${Math.round(pan * 100)}`;
}
