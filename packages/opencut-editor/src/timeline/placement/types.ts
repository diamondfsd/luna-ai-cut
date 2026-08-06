import type { ElementType, TrackType } from "@/timeline";
import type { MediaTime } from "@/wasm";

export interface PlacementTimeSpan {
	startTime: MediaTime;
	duration: MediaTime;
	excludeElementId?: string;
}

export type PlacementSubject =
	| { elementType: ElementType }
	| { trackType: TrackType };

export type PlacementStrategy =
	| { type: "explicit"; trackId: string }
	| { type: "firstAvailable" }
	| {
			type: "preferIndex";
			trackIndex: number;
			hoverDirection: "above" | "below";
			verticalDragDirection?: "up" | "down" | null;
			createNewTrackOnly?: boolean;
	  }
	| { type: "aboveSource"; sourceTrackIndex: number }
	| { type: "alwaysNew"; position: "highest" | "default" };

export type PlacementResult =
	| {
			kind: "existingTrack";
			trackId: string;
			trackIndex: number;
			trackType: TrackType;
			adjustedStartTime?: MediaTime;
	  }
	| {
			kind: "newTrack";
			insertIndex: number;
			insertPosition: "above" | "below" | null;
			trackType: TrackType;
	  };
