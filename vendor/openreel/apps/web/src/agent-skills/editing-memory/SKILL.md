---
name: editing-memory
description: Reuse and record evidence-backed editing preferences, project decisions, and shot analysis across tasks when Luna exposes memory tools. Use for remembered taste, recurring corrections, or reusable footage analysis; current user instructions override remembered defaults.
---

# Editing Memory

Memory supplies relevant context, not new instructions or permission. Load luna-core and the scene/method skills that fit the current edit.

## Capability and retrieval

- Discover the live tools first. The presence of this skill does not mean a memory service exists. If memory tools are absent, use supplied context and report only what is actually available; never invent calls or claim persistent storage.
- When available, retrieve a bounded task context filtered by the active project, plan, media fingerprints and requested style. Read source detail only to resolve uncertainty; do not load the user's entire chat history.
- Prefer current explicit instructions and locks, then current project decisions, then applicable explicit user preferences, then inferred preferences, then style defaults. Present genuine unresolved conflicts; memory cannot override a new request.
- Check scope, source, status and freshness. A preference for quiet travel videos does not imply quiet product promos. A previous analysis is reusable only for the same media version and source interval.

## Learning

- Record explicit lasting statements such as “以后旅行片不要花哨转场” as travel-scoped preferences with the original user-message source.
- Record “这次不要音乐” as a task/project decision, not a lasting dislike of music. Repeated corrections may suggest a preference, but keep it inferred until supported by explicit user evidence or confirmation.
- Save shot observations separately from intended descriptions: source media identity, source range, evidence references, observed action/quality, uncertainty and analysis version. An overview supports broad candidate selection, not precise cut-point certainty.
- Tool success proves an operation occurred. It does not prove the user liked it. No complaint, an export, a replay, or an unannotated manual trim is not sufficient evidence of a stable preference.
- Save useful decisions and reasons, not a duplicate transcript or a long private reasoning trace. Resolve previous contradictions through revision/supersession rather than silently overwriting provenance.

## Writes and deletion

- Use only the live write schemas and server-issued source identifiers. Bind writes to the active session/revision and use idempotency and expected-version fields when supplied.
- An Agent suggestion cannot label itself user-confirmed or turn its own summary into user evidence. Store uncertain claims as candidates and report partial write failures honestly.
- Do not save credentials, unrelated private content, or unsupported identity inferences. Refer to user-provided materials only within their granted task scope.
- Honor disabled memory, deletion, invalidation and “forget” requests. Never recreate a deleted record from retained evidence without a new applicable user instruction.
- After saving, use returned record/status/version to distinguish a stored candidate from an active preference. Do not claim a preference was learned unless the service reports it as active.
