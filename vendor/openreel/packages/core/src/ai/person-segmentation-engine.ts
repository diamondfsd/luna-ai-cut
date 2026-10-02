export { createMotionAwareOcclusionMask } from "./temporal-person-mask";

/** Browser model inference is removed from the Luna embedded editor. */
export const PERSON_SEGMENTATION_AVAILABLE = false;

export interface SegmentationResult {
  mask: ImageData;
  width: number;
  height: number;
  /** Timeline timestamp of the exact source frame used for this matte. */
  timestampMs: number;
  /** Low-resolution source frame that produced this mask. */
  referenceRgba: Uint8ClampedArray;
  referenceWidth: number;
  referenceHeight: number;
}

export interface PersonMaskOptions {
  /** Timeline/content time. Used for deterministic sampling and seek resets. */
  timestampMs?: number;
  /** Keeps unrelated clips and render pipelines from sharing temporal history. */
  streamId?: string;
  /** Returns the latest matte immediately while a new one runs off-thread. */
  realtime?: boolean;
}

/** Compatibility boundary for persisted effects; never downloads or runs a model. */
export class PersonSegmentationEngine {
  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  setSegmentInterval(_ms: number): void {}
  async getPersonMask(
    _frame: ImageBitmap,
    _options: PersonMaskOptions = {},
  ): Promise<SegmentationResult | null> { return null; }
  dispose(): void {}
}

const instance = new PersonSegmentationEngine();
export function getPersonSegmentationEngine(): PersonSegmentationEngine { return instance; }
export function disposePersonSegmentationEngine(): void { instance.dispose(); }
