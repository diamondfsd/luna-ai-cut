---
name: luna-core
description: Core safety and workflow rules for every Luna AI Cut editing task. Use for task sessions, media evidence, timeline writes, error recovery, verification, and export confirmation before loading scene-specific editing skills.
---

# Luna Core

Apply this skill to every editing task. Then load the method and scene/style skills whose descriptions match the request. Include director-plan-authoring for creating or revising plans, director-plan-editing for shot-grouped rough footage and editing-memory for memory-backed personalization. Their instructions do not imply unavailable tools exist.

## Core principles

- File names, capture timestamps, duration, and file size can filter candidates but cannot prove visual content.
- Inspect representative frames before choosing media, ordering shots, or setting trim points. Do not claim to have seen media without frame evidence.
- Start with a low-cost overview, then inspect only likely selections in detail.
- Do not crop every shot to the same duration. Keep a shot when its subject and action are complete.

## Session and tool contract

1. Read the live tool list. If `editorToolsReady` is false, claim or create the task, activate Luna, reload the tool list, and do not guess unavailable tools.
2. Register a stable `agentId`, honest `agentType`, and actual `agentModel` through `wait_for_edit_request` or `start_edit_session`.
3. Never invent a `sessionId`. Keep the returned session and revision for the task.
4. Before changing a project, call `list_editing_skills`, select `luna-core` plus the matching scene skills, and call `get_editing_skill` with their ids.
5. Check `ok`, `error.code`, `error.retryable`, `error.suggestedAction`, `data`, and `data.lunaAgent.requestRevision/requestChanged` on every response.
6. If `requestChanged=true` or the code is `REQUEST_UPDATED`, call `get_edit_request` and replan. Never continue an obsolete request.
7. Do not retry blindly. A retryable parameter error may be adjusted once; repeated failure, `retryable=false`, or no safe correction means stop and report failure.

## Media analysis

1. Use `list_local_media` and its structured short `mediaId` values such as `m1`, `m2`, and `m3`. Generated music uses the same sequence. Never construct ids from names or paths, and never rename returned ids.
2. Use `inspect_local_media` in `overview` mode first. For large groups, use `create_media_contact_sheet` and map frames only through returned `mediaId`, `frameId`, `timecode`, labels, and cell coordinates.
3. Inspect likely videos in `detail` mode at beginning, middle, and end before fixing source in/out points.
4. For spoken content, use `transcribe_local_media` first and work from its absolute source timestamps.

## Timeline writes

- Use `get_local_media_metadata` when exact original image or video information is needed, including dimensions, duration, frame rate, frame count, codecs, and raw metadata fields. Import media only after a project exists. A single `import_local_media` job accepts at most 50 media IDs. Local and generated assets keep the same short `mediaId` after import. Poll `get_local_media_import_status` until the job is completed, partial, or failed.
- Submit import batches at the documented limit instead of splitting a normal shoot into many tiny jobs.
- Prefer an atomic `add_clip` with source `inPoint/outPoint`. Use `trim_clip` for an existing clip.
- When adding several clips or tracks with known raw action parameters, prefer `batch_actions` over one round trip per clip, then verify the resulting timeline once with `list_clips` or `get_editor_state`.
- Verify every write with the relevant `list_*`, `get_clip`, or `get_editor_state` call. Confirm ids, track, timing, source range, and overlaps.
- Text, graphics, titles, and scrims must be on foreground overlay tracks. Verify with `list_tracks` and `list_overlays` because `list_clips` does not include overlays.
- After `add_transition`, use `list_transitions` to verify the saved type, duration, and clip ids.

## Packaging quality

- One shot should communicate one motion idea. A beat only determines timing; it does not justify stacking several effects on one shot.
- Build an energy curve: hook, establish, develop, climax or drop, then resolve. Give the strongest moment and the ending enough hold to read.
- Prefer hard cuts. Use transitions only at scene, chapter, or state changes; do not decorate every boundary.
- Keep a consistent visual language. Reuse the same typography, palette, motion direction, and timing principles rather than applying unrelated presets shot by shot.
- Read `references/packaging-principles.md` before a packaging pass or when a result looks like a preset demo rather than a finished edit.
- Read `references/packaging-recipes.md` when choosing concrete motion, title, hard-cut, or transition recipes. Select only the recipes justified by the footage and scene energy.

## Progress, failure, and export

- Tool calls already appear in Luna. Use `report_edit_progress` only at key milestones, not after every call.
- Finish with `report_edit_result` for completed, failed, or cancelled. Text chat is not a result report.
- Do not export automatically after editing, packaging, captions, or music. Complete and report the timeline so the user can preview first.
- Call `export_video` only when the current user request explicitly asks to export. If the user asks later, read the updated revision first.
- Export waits for user confirmation in Luna. `EXPORT_NOT_REQUESTED`, denial, timeout, or failure is not an exported file. Only `ok=true` with a real `data.path` is success.

## References

- Read [packaging-principles.md](references/packaging-principles.md) before packaging, polishing, or judging visual quality.
