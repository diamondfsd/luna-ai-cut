# Agent Note: Script-only editing runtime for FreeCut

Status: implemented

English | [中文](2026-08-17-script-only-editing-runtime.zh.md)

## Problem

Complex edits require repeated analysis, branching, iteration and batch timeline changes. Exposing each editing capability as a model-facing tool makes long workflows depend on many model round trips and leaves the editing strategy spread across prompt decisions and individual calls.

## Decision

The embedded FreeCut Harness exposes one editing tool, `edit.run_script`. The model provides an ESM module exporting `default async function main(luna)`, and the Harness runs it in a separate Node.js process. The script receives the `luna` SDK and uses it for project inspection, media analysis, audio generation, timeline edits and memory operations.

Existing `media.*`, `timeline.*`, `project.*`, `audio.*` and `memory.*` implementations remain renderer or host capabilities behind the SDK bridge. They are not registered in the Harness model-facing tool registry. Script method names use camelCase, while the host bridge continues to dispatch the existing internal capability names.

Script results are returned as structured tool results to the model. The host does not inspect script text or result wording to classify intent, advance workflow state or declare completion. The build copies the script runtime beside the embedded Harness plugin so development and packaged execution use the same module layout.

## Consequences

- JavaScript variables, loops, conditions, functions, promises, `async`/`await` and Node.js standard modules are available to model-authored editing scripts.
- Long-video workflows can perform local filtering and branching in one script and use batch analysis and timeline methods to reduce model and IPC round trips.
- The SDK is now the long-term editing API. New editing capabilities should add a stable SDK method and its documentation before adding any host implementation detail to the model prompt.
- A separate process keeps an uncaught script exception from terminating the Harness process. Cancellation terminates that process and aborts the outstanding host request.
- Scripts have full local Node.js access by design. The current runtime does not attempt to provide a security sandbox; process lifecycle handling remains necessary for cancellation and failed scripts.

## Alternatives considered

Registering every editing capability directly with the model was rejected because complex workflows require repeated model round trips and make the model-facing contract mirror low-level host operations. A restricted JavaScript interpreter was rejected because the product explicitly requires complete JavaScript and Node.js standard-library access. Directly editing `project.json` from scripts was rejected because it would bypass the existing validated editor capability implementations and cross the Store/persistence boundary.
