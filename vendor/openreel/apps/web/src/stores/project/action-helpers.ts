import { v4 as uuidv4 } from "uuid";
import type {
  Action,
  ActionResult,
  Project,
  Track,
  Clip,
} from "@openreel/core";
import type { ActionExecutor } from "@openreel/core";

export function createAction(
  type: string,
  params: Record<string, unknown>,
): Action {
  return {
    type,
    id: uuidv4(),
    timestamp: Date.now(),
    params,
  };
}

export async function executeWithUpdate(
  actionExecutor: ActionExecutor,
  action: Action,
  project: Project,
  setState: (updates: { project: Project }) => void,
): Promise<ActionResult> {
  const result = await actionExecutor.execute(action, project);
  if (result.success) {
    setState({
      project: {
        ...project,
        modifiedAt: Date.now(),
      },
    });
  }
  return result;
}

export function findClipInProject(
  project: Project,
  clipId: string,
): { clip: Clip; track: Track } | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) {
      return { clip, track };
    }
  }
  return undefined;
}

export function findTrackByClipId(
  project: Project,
  clipId: string,
): Track | undefined {
  return project.timeline.tracks.find((track) =>
    track.clips.some((c) => c.id === clipId),
  );
}

export function updateClipInProject(
  project: Project,
  clipId: string,
  updater: (clip: Clip) => Clip,
): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? updater(clip) : clip,
        ),
      })),
    },
    modifiedAt: Date.now(),
  };
}

export function updateTrackInProject(
  project: Project,
  trackId: string,
  updater: (track: Track) => Track,
): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) =>
        track.id === trackId ? updater(track) : track,
      ),
    },
    modifiedAt: Date.now(),
  };
}
