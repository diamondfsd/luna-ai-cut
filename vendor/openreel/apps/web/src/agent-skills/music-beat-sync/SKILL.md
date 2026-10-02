---
name: music-beat-sync
description: Music selection, layered generated BGM, beat analysis, and music-led montage pacing. Use with luna-core for travel, lifestyle and highlight montages, supplied music, rhythm, beat cuts, BGM or a musical edit.
---

# Music Beat Sync

## Non-negotiable order

- Resolve music timing before deciding cuts. Generated Luna music uses the MIDI score that actually rendered the audio: `analyze_media_beats` returns `timingSource="generated-score"`, exact tempo, beat phase and bar starts. Use those times directly; do not re-detect the waveform or shift the grid to a melody onset. External audio uses `timingSource="audio-detection"` and requires reliable waveform analysis. Never guess BPM or substitute arbitrary evenly spaced cuts.
- Generated Luna music and user-provided music use the same `analyze_media_beats` and `sync_timeline_to_beats` workflow.
- If confidence is below 0.5 or the BPM is ambiguous, do not use the returned grid for dense cuts. For a requested rhythmic montage, regenerate with a clearer drum/bass pulse or select another track and analyze again. If no reliable pulse is available, report the limitation; do not silently turn a requested fast edit into long holds.

## Music source

- Generated background music: `list_music_templates` -> `get_music_template` -> adapt DSL -> `generate_background_music` -> `import_local_media`.
- The generated result also includes `musicTiming` from the actual MIDI, with `beatTimes`, `downbeats` and `percussionHits` (time, pitch, velocity). Exact generated timing persists with the media through project saves. For older generated files without this metadata, regenerate the same DSL rather than treating a melody-derived grid as authoritative. Use actual percussion events for dense accent cuts; a tempo grid is not proof that every subdivision has an attack.
- Prefer a complete arrangement such as `rhythmic-montage` for an upbeat outing or lifestyle montage. A public-domain `*-seed` template is a melody sketch, not a finished soundtrack: add harmony, bass, percussion and variation when using one for a music-led edit.
- Build distinct intro, groove, variation/break, climax and resolved ending sections. Use complementary drum/bass, chord/pad, melodic hook and supporting arpeggio/counterline layers; make layers enter and leave instead of playing the same few notes throughout. Keep velocities balanced and leave space for speech.
- Fit section bar counts to the requested duration before setting `dur`. Merely extending `dur` does not repeat the arrangement and can leave a silent tail; truncating a long template can omit its ending. Render, analyze and check the actual result.
- User audio/video: import first, then call `analyze_media_beats` with the imported media id.
- Treat beat times as source-media seconds and map them through the audio clip's `startTime`, `inPoint`, and speed before editing the timeline.

## Cut mapping

- Survey the user's available footage before filling musical slots. Select enough visually distinct shots to cover the music; prefer different suitable takes over repeatedly slicing a small subset. Multiple non-overlapping ranges from one source are acceptable only when their visible action/detail changes meaningfully. Verify scene/subject/shot-scale contrast, not just range uniqueness or clip count.
- Use `sync_timeline_to_beats` mode `align` by default to move and trim complete visual clips into beat-sized slots.
- Use mode `split` only when the user explicitly asks to cut existing timeline clips at beat boundaries. Never use it to turn one source into repeated 0.5-second fragments.
- For a music-led montage, start with `beatUnit="segments"`, `beatsPerCut=2`, `minClipDuration=0.35`, `maxClipDuration=2.5`. Use 1 beat in the high-energy section and 2–4 beats for the body or a breath. At a detected 120 BPM this gives 0.5, 1 and 2 second slots; these durations are derived from analysis, not an assumed tempo.
- A brief half-beat accent may use the midpoint between two stable detected beats, with explicit source ranges and appropriate clip tools. Do not claim `sync_timeline_to_beats` supports fractional `beatsPerCut`; its smallest grouping is one beat.
- Alignment trims/moves existing clips; it does not invent extra shots or fill the song. Prepare enough ranges, then verify full timeline coverage, no gaps, and the intended ending after alignment.
- Prefer downbeats or strong beats for major cuts. Use kick for impact, snare for substitutions, and hihat for micro-motion density.
- Vary density with the musical sections. Fast accents can cut each beat; keep longer holds where the action or a lower-energy passage needs them.
- Reserve the strongest hits for the opening, climax, and ending. Read [references/beat-sync.md](references/beat-sync.md) for the detailed mapping and verification flow.

## Audio discipline

- Keep dialogue primary. Lower music under speech and restore it smoothly.
- Do not use music as a substitute for narrative structure. The edit must still make sense without the track.
- Verify the final timeline against the detected cut times before completion.
- Verify exported picture changes against the music score/attacks, accounting for audio clip offsets and the export frame rate. At 30 fps, snap to the nearest frame and keep the discrepancy within one frame. Preserve the original score phase. If comparison of the exported audio with its source demonstrates a codec/rendering delay, document it separately and compensate visual boundaries by the nearest frame before re-exporting; never assume one machine's or codec's delay applies to another.
