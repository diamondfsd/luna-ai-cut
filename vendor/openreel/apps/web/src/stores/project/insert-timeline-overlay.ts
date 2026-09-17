import { v4 as uuidv4 } from "uuid";
import { isOverlayTrack, resolveTimelinePlacement } from "@openreel/core";
import { useProjectStore } from "../project-store";

type OverlayTrackType = "text" | "graphics";

/**
 * Put a newly-authored visual item on an available timeline row. Occupied
 * rows stack above automatically and track creation stays in the same history
 * transaction as the item creation.
 */
export async function insertTimelineOverlay<T>(
  startTime: number,
  duration: number,
  create: (trackId: string) => T | null,
  preferredTrackId?: string,
  overlayTrackType: OverlayTrackType = "graphics",
): Promise<T | null> {
  const initialState = useProjectStore.getState();
  const initialProject = initialState.project;
  const preferredTrack = preferredTrackId
    ? initialProject.timeline.tracks.find(
        (track) => track.id === preferredTrackId,
      )
    : undefined;
  if (preferredTrackId && (!preferredTrack || preferredTrack.locked)) {
    return null;
  }
  const targetTrack = preferredTrack ?? initialProject.timeline.tracks.find(
    (track) => !track.locked && (
      overlayTrackType === "text"
        ? track.type === "text" || track.role === "captions"
        : track.type === "graphics"
    ),
  );
  const newTrackId = `track-${uuidv4()}`;
  const placement = targetTrack
    ? resolveTimelinePlacement(initialProject, {
        targetTrackId: targetTrack.id,
        startTime,
        duration,
        policy: "stack-above",
        newTrackId,
      })
    : {
        ok: true as const,
        trackId: newTrackId,
        startTime: Math.max(0, startTime),
        createdTrack: { id: newTrackId, position: 0 },
      };

  if (!placement.ok) return null;

  // A legacy overlay track can sit below media rows. If placement falls back
  // to such a row, create a dedicated foreground row instead of relying on a
  // mixed track's historical painter order.
  const placedTrack = initialProject.timeline.tracks.find(
    (track) => track.id === placement.trackId,
  );
  const safePlacement = !preferredTrackId && placedTrack && !isOverlayTrack(placedTrack)
    ? {
        ok: true as const,
        trackId: newTrackId,
        startTime: placement.startTime,
        createdTrack: { id: newTrackId, position: 0 },
      }
    : placement;

  initialState.beginHistoryGroup("Place timeline item");
  try {
    if (safePlacement.createdTrack) {
      const result = await useProjectStore.getState().addTrack(
        overlayTrackType,
        safePlacement.createdTrack.position,
        {
          mode: "standard",
          trackId: safePlacement.createdTrack.id,
        },
      );
      if (!result.success) return null;
    }
    return create(safePlacement.trackId);
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
}
