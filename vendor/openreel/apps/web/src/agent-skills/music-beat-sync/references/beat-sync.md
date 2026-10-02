# Beat Sync Workflow

## Analysis

1. Import the music or video track into the project.
2. Call `analyze_media_beats` with the imported `mediaId`.
3. Inspect `timingSource`, `bpm`, `confidence`, `beats`, `downbeats`, and `suggestedCutTimes`. Generated music uses its actual rendered MIDI (`generated-score`); read `musicTiming.percussionHits` for accent events. External music uses waveform detection (`audio-detection`). Do not replace authoritative score phase with the first melody onset. Regenerate the same DSL for older generated files lacking score metadata when precise timing is required.
4. Confidence below 0.5 or an empty grid cannot support dense cutting. For a requested fast edit, choose/regenerate clearer rhythmic music and analyze again; do not use an invented 120 BPM fallback.

## Mapping

- Source music time is relative to the media file. Timeline time is the media clip's `startTime` plus the source time adjusted by `inPoint` and speed.
- Major cuts should land on downbeats or high-strength beats.
- Kick hits are best for hard cuts and impact; snares for swaps and visual replacements; hihats only for small motion density.
- A hold after a major hit is part of the rhythm. Do not place another cut immediately unless the section is intentionally accelerating.

## Applying the grid

- `align` is the default: assign complete visual clips to beat-sized slots, moving and trimming them to the grid.
- `split` is an explicit destructive intention only: use it when the user asks to cut existing timeline clips, never to manufacture rhythm by fragmenting one source.
- Survey suitable footage first. Different non-overlapping ranges or filenames do not necessarily mean different visual ideas; compare scene, subject, action and shot scale. Use multiple ranges from a take only when they show meaningfully different moments.
- For an upbeat montage start with `beatUnit=segments`, `beatsPerCut=2`, `minClipDuration=0.35`, `maxClipDuration=2.5`; use 1 beat for a brief high-energy run and 2–4 beats for the body. At an analyzed 120 BPM, those are 0.5/1/2 seconds. Never assume that tempo before analysis.
- Half-beat accents use actual generated-score percussion events or midpoints of stable externally detected intervals, placed with explicit clip tools. The synchronization tool accepts whole-beat groups only.
- Prepare enough visual ranges for the selected music duration before alignment. Read back all clips: aligning four long clips into four one-second slots leaves a short edit, not a completed full-length montage.

## Verification

- Confirm the returned `cutTimes` and affected clip ids.
- Read the timeline back with `list_clips` or `get_clip`.
- Check that major cuts are on strong beats and that dialogue, titles, and endings are not interrupted by a mechanical cut.
- Save/reopen and verify the media and timing remain available; wait for source recovery to settle.
- When export is authorized, verify actual exported frame changes and audio, not only stored clip times. Keep score timing separate from any measured export offset. Read [export-sync.md](export-sync.md) if a timing complaint or exported mismatch requires calibration.
