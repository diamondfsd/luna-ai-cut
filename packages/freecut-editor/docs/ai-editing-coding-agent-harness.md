# AI Editing Coding Agent Harness

## Objective

The AI editor is a coding agent for a large declarative video project. It is not a chat loop that
commits one timeline action at a time. The agent receives a virtual repository, discovers relevant
files, edits source modules, runs compiler commands, inspects diagnostics and diffs, and commits one
verified build.

The existing `project.json` remains the compiled editor persistence format. The modular editing
source is durable and lives in an independent Git repository inside the Luna project directory.

The first implementation persists a versioned operation source: segment files contain
`EditOperation` values that are lowered into one `EditProgram`. Source-created timeline items carry
stable project/source refs, so a later build reconciles them instead of blindly duplicating old
inserts. A durable publication marker also makes an unchanged published Git commit a no-op.

This is cross-session safe for source-created clips, text, HTML, range replacement, and desired
removal. It is not yet a pure desired-state compiler: changed source currently replaces managed
items instead of producing a minimal entity diff, and semantic compilation still reads live editor
stores. The remaining desired-state work described below is architectural hardening.

```text
projects/{projectId}/
├── project.json
├── editing-source/
│   ├── .git/
│   ├── manifest.json
│   ├── sequences/
│   ├── segments/
│   ├── components/
│   └── tests/
```

## Runtime Architecture

The built-in agent is split into policy-free harness mechanics and Luna-specific editing policy:

```text
AI editing store
  -> conversation context manager
  -> orchestrator (composition root)
     -> agent harness runtime
        -> model driver (native tools or JSON compatibility)
        -> tool executor -> registry -> editing workspace/compiler
        -> completion policy
        -> trace/progress event sink
```

- `agent-harness/runtime.ts` owns the bounded model/tool loop, cancellation, protocol recovery,
  fallback, event emission, and stop conditions. It does not import timeline stores or provider APIs.
- `agent-harness/native-driver.ts` translates the neutral loop into native function calls. Tool names,
  argument decoding, assistant tool-call messages, and tool outputs stay in this driver.
- `agent-harness/json-driver.ts` keeps local and OpenAI-compatible models usable when native function
  calling is unavailable. JSON is a compatibility transport, not the agent's domain model.
- `agent-harness/context-manager.ts` owns context-window policy through a replaceable compactor. The
  current compactor creates a durable semantic summary while retaining recent messages verbatim.
- `orchestrator.ts` assembles the workspace prompt, driver, tool executor, completion policy, and UI
  event mapping. It must not grow a second provider-specific loop.
- The Zustand store owns UI state and durable conversation checkpoints; it does not decide tool-loop
  mechanics or inspect provider responses.

The runtime follows the tool loop documented by the OpenAI Responses API: send the available tools,
execute every returned call in the application, append tool outputs, and continue until the model
returns a final answer or the host completion policy stops the run. See the official
[function calling guide](https://developers.openai.com/api/docs/guides/function-calling).

### Context and compaction

There are three distinct context layers and they must not be collapsed into one message array:

1. **Instructions** are rebuilt from current workspace state before each model request.
2. **Working context** contains the current turn's model outputs, tool calls, and tool results.
3. **Durable conversation context** contains user-visible turns plus a persisted compaction
   checkpoint for older turns.

The current Chat Completions/local-model transports use semantic-summary compaction through
`AgentContextCompactor`. A future Responses driver should preserve the complete `response.output`
items, including reasoning and tool-call items, and replace the summary compactor with server-side
`context_management` or the standalone compact endpoint. The compact output is opaque canonical
state and must be persisted and replayed as-is rather than rewritten into a human summary. See the
official [conversation state](https://developers.openai.com/api/docs/guides/conversation-state) and
[compaction](https://developers.openai.com/api/docs/guides/compaction) guides.

This split deliberately keeps provider state out of the editing tools. Adding a Responses driver,
another hosted provider, or a stronger local model only requires a driver and, when appropriate, a
context compactor; the workspace and completion policies remain unchanged.

`project.json` stores an `aiEditingPublication` marker beside the compiled timeline. It records the
published source commit, semantic build fingerprint, revisions, and receipt in the same project
update as the timeline.

The app uses an embedded Git implementation through the Electron main process. It must not depend on
a system Git installation, alter the application source repository, or execute arbitrary shell Git
commands.

## Repository Layout

```text
/
├── media/                            # read-only, one searchable file per media item
│   ├── index.json
│   ├── media-id.json
├── evidence/                         # read-only checkout projection
│   ├── timeline/
│   │   ├── sequence.json             # track, project and bounded-window index
│   │   └── current-0001.json
│   ├── transcripts/media-id.json
│   └── visual/media-id.json
├── manifest.json                     # persisted and Git tracked
├── sequences/                        # persisted and Git tracked
│   └── main.sequence.json
├── segments/                         # persisted and Git tracked
│   ├── opening.segment.json
│   ├── interaction.segment.json
│   └── ending.segment.json
├── components/                       # persisted and Git tracked
│   ├── title-left-top.component.json
│   └── dialogue-caption.component.json
└── tests/                            # declarative acceptance constraints
    └── main.acceptance.json
```

Only editable source and tests are persisted in `editing-source` and tracked by Git. The `media` and
`evidence` trees are bounded, read-only projections regenerated for each
checkout. Only files needed by the task are read into model context. Listing and search operate over
the whole virtual repository without serializing every file into the prompt.

## Source Model

### Sequence

`manifest.json` points to `sequences/main.sequence.json`; the sequence imports ordered segment
modules.

```json
{
  "version": 1,
  "imports": [
    "segments/opening.segment.json",
    "segments/interaction.segment.json",
    "segments/ending.segment.json"
  ]
}
```

### Segment

A segment is a narrative or functional module and may contain several shots. It owns a bounded
set of editing responsibilities and currently exports up to 100 edit operations. A range is not a
field in the v1 segment schema; ranges come from its operations. Segment boundaries are a
code-organization choice, not a transaction boundary.

### Component

Components hold reusable clip or text defaults. A segment can instantiate a component and override
specific values. The compiler expands components before validating the timeline program. Components
never execute JavaScript.

### Tests

Acceptance files currently support operation count, operation-type count, latest affected output
time, merged changed duration, and required text. They do not yet validate visual coverage, blank
ranges, source audio, or final rendered duration.

## Cross-session Source Semantics

### Implemented v1 safety

The host injects `sourceProjectId` and the checkout revision during lowering. Items created by that
source persist an `aiEditingSource` owner with a stable local ref. On later builds, unchanged refs are
replaced transactionally, refs removed from source are removed from the timeline, and a persisted
`removeClip` becomes a safe desired absence after its first application. This prevents historical
insert operations from accumulating duplicate timeline items.

`timeline.build` now runs the real edit compiler in preview mode. It validates media, tracks, clip
refs, source ranges, collisions, transitions, and text changes without mutating the timeline.
`timeline.diff` returns the semantic created/updated/removed/transition diff in addition to source
operation counts and declared ranges.

After publication, `project.json` stores the Git source commit and a SHA-256 fingerprint that excludes
checkout revision and preview/commit mode. Reopening the same commit at its published revision returns
the saved success receipt without another live apply. Revision drift forces reconciliation; the same
commit producing a different semantic fingerprint is rejected.

### Remaining v2 invariant

For commit `S` and timeline state `T` produced from `S`, compiling unchanged source `S` against `T`
must produce an empty semantic diff. This idempotence is the minimum cross-session contract.

Complete it as a desired-state compiler:

1. Extend the implemented stable source keys from clips, text, and HTML to transitions and every
   future source-managed entity.
2. Make segment modules declare desired managed entities and explicit desired overrides for existing
   user entities. Inserts, updates, and removals become compiler output, not durable source commands.
3. Capture the complete immutable compiler input needed for media, tracks, clips, transitions, and
   project settings. The build compiler must receive this snapshot instead of reading live stores.
4. Compare desired entities with the checkout snapshot and emit a semantic artifact containing the
   exact insert/update/remove/transition delta. Unchanged source against its published result emits
   no operations.
5. Keep the implemented publication marker, and add recovery journaling only if project-file writes
   need stronger crash guarantees than the storage layer currently provides.
6. Detect manual drift of AI-managed entities explicitly. Either preserve the user edit and report a
   structured conflict, or restore source intent according to an explicit ownership policy; never
   silently infer ownership from time range alone.
7. Keep extending the prepared-build boundary to a complete immutable compiler input. Publication
   already fingerprints, diffs, and applies one prepared artifact without invoking a second source
   compilation; the remaining work is removing all live-store reads from that artifact's compiler.

Until the pure compiler exists, changed source may rebuild all source-owned entities. This is correct
but produces a larger diff than a true entity-level desired-state compiler.

## Agent Tools

The model receives a small, code-oriented tool surface:

- `workspace.list`: list files below a directory.
- `workspace.search`: search file paths and text with bounded results.
- `workspace.read`: read a line page from one file; defaults to 200 lines and allows at most 400.
- `workspace.patch`: create, replace, or delete source files in the checkout overlay.
- `workspace.status`: list dirty files and checkout metadata.
- `timeline.check`: parse, resolve imports, type-check and validate source.
- `timeline.build`: compile source into a complete timeline program without live mutations.
- `timeline.test`: run declarative acceptance checks against the build artifact.
- `timeline.diff`: return the real preview compiler diff plus operation counts and declared ranges.
- `timeline.commit`: compare-and-swap the verified build into the live editor.

There are no shot-specific edit tools and no model-managed `baseRevision`. The checkout owns the
expected revision.

## Git And Checkout Lifecycle

```text
capture live revision R
  -> open editing-source repository
  -> load the current Git worktree and refresh read-only projections
  -> agent reads/searches/patches files
  -> check -> build -> test -> diff
  -> create Git source commit S
  -> commit build(S, expected R)
  -> live adapter performs one undo transaction
  -> write compiled timeline and publication marker together to project.json
```

Checking, building, testing, diffing, and Git source commits cannot access live timeline mutation
APIs. `timeline.commit` is the only live write boundary. Publication prepares one build artifact and
uses that exact artifact for its semantic diff, fingerprint, and final apply. If the production
baseline changes, the prepared artifact is rejected as stale. A checkout deduplicates in-flight
publication in memory, while the project publication marker provides cross-process idempotency for
an unchanged commit at the published revision.

If the live revision differs from the checkout revision, publish returns a structured conflict and no
timeline data changes. The source commit remains durable. A later turn can create a fresh projection,
but automatic rebase/merge behavior is not implemented; the model never edits a revision number.

The agent tool surface exposes bounded Git commands: `git.status`, `git.diff`, `git.log`,
`git.branch`, and `git.commit`. `git.branch` can list refs or create a ref but does not switch the
worktree; checkout and restore are not currently exposed to the model. Force push, remote operations,
hooks, arbitrary Git configuration and commands outside the project repository are not available.

## Compiler Pipeline

The implemented pipeline is:

1. Parse JSON source files.
2. Resolve sequence imports and reject cycles or missing modules.
3. Resolve component instances and merge typed overrides.
4. Validate the `EditProgram` shape and inject the host-owned project id and base revision.
5. Reconcile stable source-owned refs against the current timeline in preview mode.
6. Validate media/track/clip references, source ranges, overlaps, transitions, and text changes.
7. Run acceptance checks and return the semantic preview diff plus source metrics.
8. Compare the live revision, execute one timeline transaction, and persist its publication marker.

The remaining v2 work is to make step 5 consume a complete immutable checkout snapshot and have
commit apply the already-built artifact. The current implementation safely recompiles before the
write and performs revision checks, but build and commit still read live stores independently.

Diagnostics contain stable codes, severity, file path and optional JSON path. Natural-language text
is supplementary and must not be the recovery protocol.

## Large Project Strategy

- Current timeline files are sorted chronologically and split by a bounded clip count. Their range
  metadata describes each chunk; they are not fixed-duration time windows.
- Media and evidence are separate searchable files.
- The initial prompt contains repository instructions and project counts, not file contents.
- Lists, file reads, and returned search pages are bounded. Search stops after the requested bounded
  page plus one result and caps its cursor; durable source files also have host-side size budgets.
- Generated source is split by narrative modules and reusable components.
- Build artifacts are summarized; the agent reads full diagnostics or diffs only when needed.
- No model round count limits the number of shots in the compiled video.

## Remaining Regression Tests

Publication-marker, source-ref reconciliation, linked-item cleanup, desired removal, Git rollback,
and bounded search/read behavior have direct coverage. The remaining hardening contracts are:

1. Publish `S`, modify one segment into `S2`, and assert that only the changed desired entities appear
   in the diff; previously published inserts must not replay.
2. Reopen with a dirty Git worktree and assert editable source is preserved while every `media/` and
   `evidence/` file comes from the new checkout projection.
3. Delete or replace a referenced media item or track between sessions and assert `timeline.build`
   returns a path-aware diagnostic without calling live mutation APIs.
4. Manually edit an AI-managed timeline item after publication and assert the chosen ownership policy
   returns a deterministic drift result.
5. Assert build and commit consume the same immutable artifact; mutate live state before commit and
   verify a revision conflict occurs before any partial write.
6. Exercise one oversized clip projection, source file, and high-match search to verify byte and work
   budgets rather than only item-count pagination.

## Completion Semantics

Text-only requests complete when the agent returns a final response without dirty source files.
Editing requests complete only after a successful `timeline.commit`. The host derives completion from
the checkout state; a `workflow.finish` tool is not part of the coding harness.

## Migration

1. Add virtual filesystem, durable Git repository and isolated checkout primitives.
2. Add an Electron host service for embedded Git and project-scoped source paths.
3. Add a projection adapter for the current timeline and media stores.
4. Add source parser, component resolver and EditProgram lowering.
5. Add code-oriented tools and a coding-agent orchestration loop.
6. Route AI editing turns through the new harness behind one implementation switch.
7. Port behavior tests, then remove one-shot prompts and direct edit tools.
