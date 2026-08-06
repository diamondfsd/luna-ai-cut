import type { TrackType } from "@/timeline";

export const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
	video: "Video track",
	text: "Text track",
	audio: "Audio track",
	graphic: "Graphic track",
	effect: "Effect track",
} as const;
