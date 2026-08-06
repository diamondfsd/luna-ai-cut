/**
 * Motion text — per-character / per-word / per-line text animation.
 *
 * Pure evaluation core (no React, no stores): unit segmentation, the
 * per-glyph analytic evaluator, and the preset catalog. Consumed by the GPU
 * glyph-atlas pipeline (infrastructure) and the editor UI (features).
 *
 * Design doc: docs/plans/2026-07-03-001-feat-motion-text-plan.md
 */

export { evaluateGlyphMotion, getActiveTextMotionSlot, isTextMotionActive } from './evaluate'
export type { GlyphMotionState, GlyphMotionContext } from './evaluate'

export { segmentTextUnits } from './segment-units'
export type { TextUnitSegmentation } from './segment-units'

export {
  getTextMotionPreset,
  createTextMotionEffect,
  TEXT_MOTION_IN_PRESETS,
  TEXT_MOTION_OUT_PRESETS,
  TEXT_MOTION_LOOP_PRESETS,
} from './text-motion-presets'
export type { TextMotionPreset, TextMotionChannelContext } from './text-motion-presets'

export {
  TEXT_MOTION_IN_PRESET_IDS,
  TEXT_MOTION_OUT_PRESET_IDS,
  TEXT_MOTION_LOOP_PRESET_IDS,
} from './text-motion-preset-ids'
export type {
  TextMotionInPresetId,
  TextMotionOutPresetId,
  TextMotionLoopPresetId,
  TextMotionPresetId,
} from './text-motion-preset-ids'
