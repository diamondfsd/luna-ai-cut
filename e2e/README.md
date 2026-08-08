# Electron E2E

Electron E2E uses Playwright Test and the shared `lunaElectron` fixture.

## Shared Workspace Mode

Shared workspace mode lets the developer and Codex test the same FreeCut project together. It launches the application with the current Electron user-data directory, so the project list, media library, and project files are the same ones visible to the developer.

Enable it only for a named, agreed user action:

```bash
LUNA_E2E_LIVE=1 \
LUNA_E2E_PROJECT_ID="project-id" \
pnpm exec playwright test e2e/freecut-current-project-drag.e2e.spec.ts --workers=1
```

In this mode:

- Playwright opens and operates the real project data under `freecut-workspace/`.
- The fixture requires the user-data directory to exist and never overwrites `settings.json`.
- Each test must name its project ID, perform the agreed UI action, and verify the corresponding disk state such as `project.json`.
- The action is intentionally retained for the developer to inspect. Do not add automatic cleanup, deletion, export, or overwrite steps unless the developer has explicitly requested them.
- Temporary files are limited to Playwright logs and failure evidence. They are separate from the user-data directory and are removed after a successful run.

Use this mode for paired feature checks and targeted regression reproduction. Keep the default fixture mode for isolated automated regression tests, CI, or any case that may modify, delete, or corrupt data.

## Current Shared Check

`freecut-current-project-drag.e2e.spec.ts` is the reference case for the paired workflow:

1. Open the project selected by `LUNA_E2E_PROJECT_ID`.
2. Drag the existing media card to a video track.
3. Assert the timeline updates in the application.
4. Assert the matching timeline item is saved in `project.json`.

The test deliberately requires an empty timeline before it runs so it cannot silently add duplicate media to a shared project.

`freecut-current-project-ai-edit.e2e.spec.ts` is the paired acceptance case for a real AI edit. It removes only the agreed stale test title, submits the configured AI request, and retains the generated result for inspection:

```bash
LUNA_E2E_LIVE=1 \
LUNA_E2E_PROJECT_ID="project-id" \
pnpm exec playwright test e2e/freecut-current-project-ai-edit.e2e.spec.ts --workers=1
```

For the `product-ui-launch` skill, the accepted run also persists its production blueprint and compiler review in the project's `ai-editing-runs.json`. This makes the planned shots inspectable alongside the resulting timeline.
