---
name: director-plan-authoring
description: Create importable Markdown director plans or revise existing shot plans from user goals, applicable preferences and available footage. Use before filming or editing when asked to design or change a plan; preserve existing shot identities and material associations during revisions.
---

# Director Plan Authoring

Design the story and practical shot objectives before selecting final footage. Combine with relevant scene/style skills and editing-memory when remembered context is available; use director-plan-editing when evaluating rough takes.

## Ground the plan

- Separate pre-shoot planning from footage-grounded planning. Before filming, describe intended captures; after filming, inspect supplied footage and distinguish verified coverage from missing shots. Never describe planned scenes as already captured.
- Use the user's purpose, audience, delivery format, target duration and actual filming conditions. Ask only about missing information that materially affects the plan; otherwise state useful assumptions with the proposal, outside importable Markdown.
- Reuse applicable explicit preferences, but current instructions win. Prior generated plans are proposals, not evidence that the user approved their style.
- Give each shot a clear story function, observable action/subject, practical framing/movement and approximate edited duration. Avoid mechanically equal durations or movements that equipment and circumstances cannot support.
- Make adjacent shots complementary. For a process, cover setup/action/result; for a story, cover the requested emotional arc. If footage lacks a needed event, offer a missing-shot note or a permitted alternative rather than inventing it.

## Create

- Read [markdown-format.md](references/markdown-format.md) before emitting importable text. Use the supported format; no invented IDs, media paths, attachments or lock fields in Markdown.
- If plan format/validation tools exist, read their current version and validate before creation. Otherwise emit clean Markdown for the existing text/file import and state that no plan was persisted.
- A request to propose a plan is not a request to import or edit the timeline. Create a stored plan through tools only when the current task requests it. Discover tools before calling them; this skill does not establish that plan tools exist.

## Revise

- Read the existing plan and its snapshot/version, shot IDs and material associations before proposing changes. Provide a focused change set and flag effects on assigned takes or an existing timeline.
- Plain Markdown import creates new shot IDs; importing into an existing plan appends shots. Do not use either as an in-place update mechanism.
- When ID-aware revision tools are available, address existing shots by server-returned shotId and supply the expected snapshot. Renaming or reordering retains identity and materials; new shots receive server IDs. Never match identity from a shot title or ordinal alone.
- If revision tools are unavailable, return proposed changes keyed to existing IDs for manual application. Do not claim that a Markdown re-import preserves associations.
- Removing or splitting a shot needs an explicit policy for its assigned materials. Keep originals; do not delete files or silently redistribute takes. A plan edit does not authorize changes to an existing timeline.
- Revalidate total duration, practical coverage, user constraints and version after revisions. If a phone or user has changed the plan, re-read and merge intent; do not overwrite the newer snapshot.
