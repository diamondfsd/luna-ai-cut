import type { MulticamManifest } from "./manifest";
import type { MulticamShot, MulticamShotPlan } from "./shot-planner";

export interface MulticamFaceSignal {
  participantId: string;
  timeMs: number;
  smile: number;
  surprise: number;
  headMotion: number;
}

export interface MulticamReactionCue {
  participantId: string;
  startMs: number;
  endMs: number;
  confidence: number;
  kind: "smile" | "surprise" | "movement";
}

export function detectMulticamReactionCues(
  signals: readonly MulticamFaceSignal[],
  options: { threshold?: number; mergeGapMs?: number; minimumMs?: number } = {},
): MulticamReactionCue[] {
  const threshold = options.threshold ?? 0.55;
  const mergeGapMs = options.mergeGapMs ?? 750;
  const minimumMs = options.minimumMs ?? 300;
  const candidates = [...signals]
    .filter((signal) =>
      Math.max(signal.smile, signal.surprise, signal.headMotion) >= threshold,
    )
    .sort((left, right) =>
      left.participantId.localeCompare(right.participantId) || left.timeMs - right.timeMs,
    )
    .map((signal) => {
      const ranked = [
        { kind: "smile" as const, value: signal.smile },
        { kind: "surprise" as const, value: signal.surprise },
        { kind: "movement" as const, value: signal.headMotion },
      ].sort((left, right) => right.value - left.value)[0]!;
      return {
        participantId: signal.participantId,
        startMs: signal.timeMs,
        endMs: signal.timeMs + minimumMs,
        confidence: ranked.value,
        kind: ranked.kind,
      };
    });
  const output: MulticamReactionCue[] = [];
  for (const cue of candidates) {
    const previous = output[output.length - 1];
    if (
      previous &&
      previous.participantId === cue.participantId &&
      previous.kind === cue.kind &&
      cue.startMs - previous.endMs <= mergeGapMs
    ) {
      previous.endMs = cue.endMs;
      previous.confidence = Math.max(previous.confidence, cue.confidence);
    } else {
      output.push({ ...cue });
    }
  }
  return output;
}

function reactionShot(
  source: MulticamShot,
  cue: MulticamReactionCue,
  manifest: MulticamManifest,
  startMs: number,
  endMs: number,
): MulticamShot | undefined {
  const camera = manifest.cameras.find(
    (entry) => entry.subject === cue.participantId && entry.type === "closeup",
  );
  if (!camera) return undefined;
  return {
    ...structuredClone(source),
    startMs,
    endMs,
    layout: {
      template: "solo",
      panels: [{
        cameraId: camera.id,
        subject: cue.participantId,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      }],
    },
    transitionIn: { type: "cut", durationMs: 0 },
    reason: "reaction-shot",
    confidence: cue.confidence,
  };
}

/** Inserts high-confidence listener reactions without changing the activity artifact. */
export function incorporateMulticamReactionCues(
  plan: MulticamShotPlan,
  manifest: MulticamManifest,
  cues: readonly MulticamReactionCue[],
): MulticamShotPlan {
  let shots = plan.shots.map((shot) => structuredClone(shot));
  for (const cue of [...cues].sort((left, right) => left.startMs - right.startMs)) {
    if (cue.confidence < 0.65) continue;
    const index = shots.findIndex(
      (shot) =>
        shot.startMs <= cue.startMs &&
        shot.endMs >= cue.endMs &&
        shot.layout.panels.every((panel) => panel.subject !== cue.participantId),
    );
    if (index < 0) continue;
    const source = shots[index]!;
    const duration = Math.min(1_800, Math.max(600, cue.endMs - cue.startMs));
    const startMs = Math.max(source.startMs, cue.startMs);
    const endMs = Math.min(source.endMs, startMs + duration);
    const inserted = reactionShot(source, cue, manifest, startMs, endMs);
    if (!inserted || endMs <= startMs) continue;
    const replacement: MulticamShot[] = [];
    if (source.startMs < startMs) replacement.push({ ...source, endMs: startMs });
    replacement.push(inserted);
    if (endMs < source.endMs) replacement.push({ ...source, startMs: endMs });
    shots.splice(index, 1, ...replacement);
  }
  return { ...plan, shots };
}
