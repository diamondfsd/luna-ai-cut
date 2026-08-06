import type { SnapPoint } from "@/timeline/snapping";
import type { MediaTime } from "@/platform/media-time";

export function getPlayheadSnapPoints({
	playheadTime,
}: {
	playheadTime: MediaTime;
}): SnapPoint[] {
	return [{ time: playheadTime, type: "playhead" }];
}
