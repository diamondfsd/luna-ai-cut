---
name: director-plan-editing
description: Edit rough footage assigned to director-plan shots by checking actual content, finding usable source ranges, and assembling the intended story. Combine with scene and style skills when a director plan or shot-grouped footage is supplied.
---

# Director Plan Editing

Treat the plan as narrative intent and candidate grouping. Rough takes still need inspection; a shot description does not prove the intended action was captured.

## Establish the contract

- Load luna-core and relevant scene/style skills. This skill guides footage selection; it does not prescribe a single finished-video style.
- Read the supplied plan through available tools or task context. Preserve plan, shot, take and returned media identifiers. Never infer group membership from list order or invent a missing tool.
- If the plan or take-to-media mapping is unavailable, report the missing context before plan-dependent edits. Do not request arbitrary filesystem access as a substitute for HTTP tools.
- Separate required constraints from guidance. Default to plan order and group-local selection; shot duration is a target. Existing selected_range and markers are references unless the current task explicitly locks them. Do not silently reinterpret historical marks as locks.
- Current user instructions determine authorized changes. Do not borrow from another shot, omit a required shot, reorder locked shots, or extend a locked range to satisfy a duration target. Surface incompatible constraints.

## Inspect within each shot

1. Identify what this shot must communicate and how it connects to its neighbors: establish place, show an action, reveal a result, or resolve the story.
2. Check availability and exact duration. Inspect a low-cost overview of the group's candidates, prioritizing marked ranges. For long takes, use overview frames and relevant speech to locate likely intervals; do not inspect every frame by default.
3. Inspect candidate intervals more closely before choosing source in/out points. Verify action beginnings and endings, focus, obstructions, camera settling, useful sound, and redundant footage. Sparse frames cannot establish precise motion or cut points; narrow the interval and gather more evidence when needed.
4. If references do not contain enough usable content, expand to the same take and then other takes in the same group, within explicit constraints. Report gaps when available footage cannot serve the objective.
5. Select for narrative fit, action completeness, continuity and usable quality together. A prettier frame need not be the best storytelling segment. Multiple short segments may represent one planned shot when they show distinct necessary stages.

## Assemble and verify

- Keep analysis timestamps in original source coordinates. Plan ranges use milliseconds; convert explicitly to the live editing tool's units. Track source ranges separately from timeline placement and playback speed.
- Complete the group's action without preserving preparation, repeated failed attempts, or idle time unless they serve the requested style. Do not claim speech or events absent from evidence.
- Apply scene/style rules inside the plan's permitted freedom. Beat alignment must not push source ranges outside locks or remove necessary action; verify source ranges again after timing changes.
- When structured proposal validation/application tools are present, submit the proposal for validation before applying it. Otherwise use existing verified timeline tools and check constraints explicitly; do not claim application-level enforcement exists.
- Retain shot/take provenance when supported. On a targeted revision, preserve unrelated clips and user edits; if provenance is missing, inspect the current timeline rather than rebuilding it blindly.
- Report missing footage separately from editing failure. A structurally valid timeline is not proof of narrative coverage; verify both and finish through the existing task-result contract.

## Example

For “pitch the tent” with five rough takes, locate unfolding, pole insertion, fastening and the completed tent. Select complementary action segments instead of five attractive but repetitive openings. If no take shows the completed tent, report that missing beat rather than describing it as captured.
