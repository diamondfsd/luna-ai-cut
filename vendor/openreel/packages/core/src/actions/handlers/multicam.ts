import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import type { Track } from "../../types/timeline";
import type { MultiCamGroup } from "../../video/multicam-engine";
import type { ActionHandler } from "../registry";
import { registerActionHandler } from "../registry";

interface ApplyMulticamEditParams {
  outputTrack?: Track;
  outputTracks?: Track[];
  outputTrackPosition?: number;
  sourceTrackIds: string[];
  groups: MultiCamGroup[];
}

interface RestoreMulticamEditParams {
  outputTrackIds: string[];
  priorOutputTracks: Array<{ track: Track; position: number }>;
  sourceTrackStates: Array<{ trackId: string; hidden: boolean; muted: boolean }>;
  groups: MultiCamGroup[];
}

function outputTracks(params: ApplyMulticamEditParams): Track[] {
  return params.outputTracks ?? (params.outputTrack ? [params.outputTrack] : []);
}

function invalid(message: string): ValidationResult {
  return { valid: false, errors: [{ code: "INVALID_PARAMS", message }] };
}

function applyEdit(
  project: Project,
  params: ApplyMulticamEditParams,
): void {
  const outputs = outputTracks(params);
  const outputIds = new Set(outputs.map((track) => track.id));
  const sourceIds = new Set(params.sourceTrackIds);
  const withoutOutput = project.timeline.tracks
    .filter((track) => !outputIds.has(track.id))
    .map((track) =>
      sourceIds.has(track.id)
        ? { ...track, hidden: true, muted: true }
        : track,
    );
  const position = Math.max(
    0,
    Math.min(params.outputTrackPosition ?? 0, withoutOutput.length),
  );
  const tracks = [...withoutOutput];
  tracks.splice(position, 0, ...structuredClone(outputs));
  Object.assign(project.timeline as unknown as Record<string, unknown>, { tracks });
  Object.assign(project as unknown as Record<string, unknown>, {
    multicamGroups: structuredClone(params.groups),
  });
}

const applyMulticamEdit: ActionHandler = {
  type: "multicam/applyEdit",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as unknown as Partial<ApplyMulticamEditParams>;
    const outputs = outputTracks(params as ApplyMulticamEditParams);
    if (!outputs.length || outputs.some((track) => typeof track.id !== "string")) {
      return invalid("multicam/applyEdit requires at least one output track");
    }
    if (outputs.some((track) => track.type !== "video")) {
      return invalid("multicam outputs must be video tracks");
    }
    if (outputs.some((track) => !Array.isArray(track.clips) || track.clips.some(
      (clip) => clip.trackId !== track.id,
    ))) {
      return invalid("every multicam clip must target the output track");
    }
    if (!Array.isArray(params.sourceTrackIds) || !Array.isArray(params.groups)) {
      return invalid("multicam/applyEdit requires source tracks and groups");
    }
    const knownTrackIds = new Set(project.timeline.tracks.map((track) => track.id));
    const unknown = params.sourceTrackIds.find((id) => !knownTrackIds.has(id));
    return unknown ? invalid(`multicam source track not found: ${unknown}`) : { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    applyEdit(project, action.params as unknown as ApplyMulticamEditParams);
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as unknown as ApplyMulticamEditParams;
    const outputIds = outputTracks(params).map((track) => track.id);
    const priorOutputTracks = projectBefore.timeline.tracks.flatMap((track, position) =>
      outputIds.includes(track.id) ? [{ track: structuredClone(track), position }] : [],
    );
    return {
      type: "multicam/restoreEdit",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        outputTrackIds: outputIds,
        priorOutputTracks,
        sourceTrackStates: params.sourceTrackIds.flatMap((trackId) => {
          const track = projectBefore.timeline.tracks.find((entry) => entry.id === trackId);
          return track
            ? [{ trackId, hidden: track.hidden, muted: track.muted }]
            : [];
        }),
        groups: structuredClone(projectBefore.multicamGroups ?? []),
      },
    };
  },
};

const restoreMulticamEdit: ActionHandler = {
  type: "multicam/restoreEdit",
  validate(action: Action): ValidationResult {
    const params = action.params as unknown as Partial<RestoreMulticamEditParams>;
    return Array.isArray(params.outputTrackIds) && Array.isArray(params.groups)
      ? { valid: true, errors: [] }
      : invalid("multicam/restoreEdit requires a prior edit snapshot");
  },
  apply(action: Action, project: Project): void {
    const params = action.params as unknown as RestoreMulticamEditParams;
    const states = new Map(params.sourceTrackStates.map((entry) => [entry.trackId, entry]));
    const tracks = project.timeline.tracks
      .filter((track) => !params.outputTrackIds.includes(track.id))
      .map((track) => {
        const state = states.get(track.id);
        return state ? { ...track, hidden: state.hidden, muted: state.muted } : track;
      });
    for (const entry of [...params.priorOutputTracks].sort((left, right) => left.position - right.position)) {
      tracks.splice(
        Math.max(0, Math.min(entry.position, tracks.length)),
        0,
        structuredClone(entry.track),
      );
    }
    Object.assign(project.timeline as unknown as Record<string, unknown>, { tracks });
    Object.assign(project as unknown as Record<string, unknown>, {
      multicamGroups: structuredClone(params.groups),
    });
  },
  invert(): Action | null {
    return null;
  },
};

registerActionHandler(applyMulticamEdit);
registerActionHandler(restoreMulticamEdit);
