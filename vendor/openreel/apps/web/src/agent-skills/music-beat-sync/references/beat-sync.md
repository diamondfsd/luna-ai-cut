# Beat Sync Workflow

## Analysis

1. Import the music or video track into the project.
2. Call `analyze_media_beats` with the imported `mediaId`.
3. Inspect `bpm`, `confidence`, `beats`, `downbeats`, and `suggestedCutTimes`.
4. Stop dense cutting if confidence is low. Use only major section boundaries.

## Mapping

- Source music time is relative to the media file. Timeline time is the media clip's `startTime` plus the source time adjusted by `inPoint` and speed.
- Major cuts should land on downbeats or high-strength beats.
- Kick hits are best for hard cuts and impact; snares for swaps and visual replacements; hihats only for small motion density.
- A hold after a major hit is part of the rhythm. Do not place another cut immediately unless the section is intentionally accelerating.

## Applying the grid

- `align` is the default: assign complete visual clips to beat-sized slots, moving and trimming them to the grid.
- `split` is an explicit destructive intention only: use it when the user asks to cut existing timeline clips, never to manufacture rhythm by fragmenting one source.
- Do not create two or more adjacent cuts from the same `mediaId` merely because the beat grid is dense. Use another source shot or keep the shot longer.
- Start with `beatUnit=downbeats`, moderate sensitivity, and 2-4 beat segments. Increase density only for a visibly high-energy section.

## Verification

- Confirm the returned `cutTimes` and affected clip ids.
- Read the timeline back with `list_clips` or `get_clip`.
- Check that major cuts are on strong beats and that dialogue, titles, and endings are not interrupted by a mechanical cut.
