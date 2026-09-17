# Packaging Recipes

These recipes adapt the motion vocabulary used by cinematic product edits to OpenReel timeline tools. Choose selectively; they are not a checklist to apply to every shot.

## Cold Open Three-Hit

Use when the footage contains three visually distinct strong moments.

- Place three 0.25-0.4 second shots back-to-back at the start.
- Give each shot a different composition; do not use three near-duplicates.
- Add a tiny scale move inside each shot only if a still frame feels dead.
- After the third hit, hard cut to the title or main establishing shot and hold.

Tools: `add_clip`, `trim_clip`, `set_clip_keyframes`, `create_text_clip`.

## Crash Zoom And Hold

Use for a key reveal, product feature, or important subject.

- Move from a readable full frame to the target in about 0.2-0.4 seconds.
- Use scale keyframes with an ease-in acceleration.
- Stop on the target composition and hold long enough to read it.
- Do not add shake and bounce together; choose one landing style.

Tools: `set_clip_keyframes`, `set_clip_transform`.

## Single-Direction Push Or Pull

Use for calm emphasis and nearly any hero shot.

- Move scale from 1.00 to roughly 1.06-1.12 across most of the shot.
- Use one direction only. Do not combine a push, rotation, and lateral drift.
- Keep the subject inside the frame throughout the move.
- Hold at the endpoint rather than returning immediately.

Tools: `set_clip_keyframes`, `set_clip_transform`.

## Accelerating Hard-Cut Run

Use only once, near the highest-energy section.

- Begin with a longer shot, then shorten successive shot lengths.
- Example at 30 fps: 0.5s, 0.4s, 0.27s, 0.2s.
- Use hard cuts and distinct compositions from the same story or subject.
- Follow the run with a longer shot or hold; do not continue at maximum speed.

Tools: `add_clip`, `trim_clip`, `list_clips`.

## Smash Cut To Stillness

Use to end a climax or reveal.

- Keep the preceding shot moving until the cut.
- Cut directly to a locked, readable frame.
- Hold without adding another transition or overlay.
- If music is present, place the cut on a strong beat and let the following silence or tail read.

Tools: `add_clip`, `set_clip_keyframes`, `analyze_media_beats`, `sync_timeline_to_beats`.

## Marker Underline Title

Use for a factual title with one keyword to emphasize.

- Reveal the title first, then add the underline or accent shape 0.1-0.2 seconds later.
- Animate the underline from one side to the other in about 0.25-0.4 seconds.
- Keep the underline close to the text baseline and inside the title safe area.
- Hold the complete title before fading out.

Tools: `create_text_clip`, `update_text_clip`, `create_shape_clip`, `set_clip_keyframes`.

## Flash-Cut Accent

Use for a deliberate impact, not as a routine transition.

- Add a brief white or tinted overlay for roughly 1-2 frames.
- Align the flash with a strong beat or the instant of impact.
- Keep the next image readable during and after the flash.
- Limit this to once per short edit; repeated flashing becomes unreadable.

Tools: `create_shape_clip`, `set_clip_keyframes`, `analyze_media_beats`.

## Layered Depth Push

Use when a scene has a clear foreground and background.

- Move the background slightly while moving the foreground more.
- Keep the primary subject sharp and readable.
- Use small differences in motion, not chaotic independent movement.
- Reserve this for one or two establishing moments.

Tools: `add_track`, `set_clip_transform`, `set_clip_keyframes`.

## Selection Rules

- Pick at most one primary recipe for a section.
- Do not repeat the same recipe on adjacent shots.
- The strongest recipe belongs on the strongest story moment.
- If a recipe hides the subject or makes text unreadable, remove it instead of tuning it endlessly.
