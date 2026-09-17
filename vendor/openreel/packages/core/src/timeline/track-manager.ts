import type { Track, Timeline, Clip } from "../types";
import type { Action } from "../types/actions";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";

export interface TrackManagerOptions {
  executor?: ActionExecutor;
  history?: ActionHistory;
}

export interface CreateTrackParams {
  type: "video" | "audio" | "image";
  name?: string;
  position?: number;
}

export interface TrackOperationResult {
  success: boolean;
  trackId?: string;
  error?: string;
}

export class TrackManager {
  private executor: ActionExecutor;

  constructor(options: TrackManagerOptions = {}) {
    this.executor = options.executor || new ActionExecutor(options.history);
  }

  async addTrack(
    timeline: Timeline,
    params: CreateTrackParams,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/add",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackType: params.type,
        position: params.position,
        name: params.name,
      },
    };
    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    if (result.success) {
      const newTrack = project.timeline.tracks.find(
        (t: Track) => !timeline.tracks.some((existing) => existing.id === t.id),
      );
      return {
        success: true,
        trackId: newTrack?.id,
      };
    }

    return {
      success: false,
      error: result.error?.message,
    };
  }

  async removeTrack(
    timeline: Timeline,
    trackId: string,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/remove",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      error: result.error?.message,
    };
  }

  async reorderTrack(
    timeline: Timeline,
    trackId: string,
    newPosition: number,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/reorder",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId,
        newPosition,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      error: result.error?.message,
    };
  }

  async setTrackLocked(
    timeline: Timeline,
    trackId: string,
    locked: boolean,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/lock",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId,
        locked,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      error: result.error?.message,
    };
  }

  async setTrackHidden(
    timeline: Timeline,
    trackId: string,
    hidden: boolean,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/hide",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId,
        hidden,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      error: result.error?.message,
    };
  }

  async setTrackMuted(
    timeline: Timeline,
    trackId: string,
    muted: boolean,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/mute",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId,
        muted,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      error: result.error?.message,
    };
  }

  async setTrackSolo(
    timeline: Timeline,
    trackId: string,
    solo: boolean,
  ): Promise<TrackOperationResult> {
    const action: Action = {
      type: "track/solo",
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      params: {
        trackId,
        solo,
      },
    };

    const project = this.createProjectWrapper(timeline);
    const result = await this.executor.execute(action, project);

    return {
      success: result.success,
      error: result.error?.message,
    };
  }

  getTrack(timeline: Timeline, trackId: string): Track | undefined {
    return timeline.tracks.find((t) => t.id === trackId);
  }

  getTracksByType(
    timeline: Timeline,
    type: "video" | "audio" | "image",
  ): Track[] {
    return timeline.tracks.filter((t) => t.type === type);
  }

  getVisibleTracks(timeline: Timeline): Track[] {
    return timeline.tracks.filter((t) => !t.hidden);
  }

  getUnlockedTracks(timeline: Timeline): Track[] {
    return timeline.tracks.filter((t) => !t.locked);
  }

  isTrackLocked(timeline: Timeline, trackId: string): boolean {
    const track = this.getTrack(timeline, trackId);
    return track?.locked ?? false;
  }

  isTrackHidden(timeline: Timeline, trackId: string): boolean {
    const track = this.getTrack(timeline, trackId);
    return track?.hidden ?? false;
  }

  getExecutor(): ActionExecutor {
    return this.executor;
  }

  private createProjectWrapper(timeline: Timeline): any {
    return {
      id: "temp-project",
      name: "Temp Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: { items: [] },
      timeline,
    };
  }
}

export function createTrack(
  type: "video" | "audio" | "image",
  name?: string,
): Track {
  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type,
    name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Track`,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

export function cloneTrack(track: Track): Track {
  return {
    ...track,
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    clips: track.clips.map((clip) => ({
      ...clip,
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    })),
    transitions: track.transitions.map((transition) => ({
      ...transition,
      id: `transition-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    })),
  };
}

export function getTrackClips(track: Track): Clip[] {
  return [...track.clips];
}

export function canAcceptMediaType(
  _track: Track,
  _mediaType: "video" | "audio" | "image",
): boolean {
  return true;
}
