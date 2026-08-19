# Luna Editor SDK

`@luna/editor-sdk` is the runtime-neutral public contract and JavaScript client
for Luna editing applications. It is intentionally independent of FreeCut,
Luna AI Cut, React, Zustand, Electron, and DeepSeek Harness.

## Boundaries

```text
Editor Core adapter -> Luna SDK contracts -> transport -> host capability server
```

The SDK does not implement timeline operations or persistence. A host adapter
implements the contracts for its own editor core. The same client can call a
FreeCut adapter today and a Luna AI Cut adapter later.

The package currently provides:

- `contracts/`: JSON-safe project, media, timeline, preview, render, AI, job,
  capability, and error types.
- `client/`: the namespaced `createLunaClient()` facade.
- `transport/`: the transport interface and loopback HTTP implementation.

## Wire protocol

Every request is an explicit envelope:

```json
{
  "protocol": "luna.editor",
  "apiVersion": 1,
  "requestId": "request-001",
  "sessionId": "session-001",
  "projectId": "project-001",
  "name": "timeline.clips.trim",
  "args": {}
}
```

The host must return a matching success or error envelope. The transport
rejects incompatible protocol versions, missing success flags, malformed
result metadata, and responses for a different request ID.

Successful client calls are normalized to `OperationResult<T>` with an
`operationId`, affected/created/removed IDs, warnings, and an optional opaque
revision. The wire `operationId` is optional; the client uses the request ID as
the fallback so older hosts can still correlate the operation.

## Units and identifiers

- `Timecode` is always explicit: `{ seconds }` or `{ frames, fps? }`.
- Render and preview APIs use `Timecode`; adapters must not infer units from a
  bare number.
- `Revision` is opaque to the SDK. A host may use the recommended
  `sha256:<64 lowercase hex characters>` form.
- Long-running transcription, analysis, speech, music, and render work uses
  the same `Job` registry and `jobId` field.
- User messages and editor data are transported as structured fields. The SDK
  does not infer intent or create workflow state from natural-language text.

## Example

```ts
const luna = createLunaClient({ endpoint, token, context: { sessionId, projectId } })

await luna.timeline.clips.trim({
  clipId,
  edge: "start",
  amount: { seconds: 1.5 },
  mode: "ripple",
})

await luna.render.frame({
  at: { seconds: 4 },
  format: "png",
})
```

## Development

```bash
pnpm --dir packages/luna-editor-sdk typecheck
pnpm --dir packages/luna-editor-sdk test:protocol
```

The package is currently ESM-only and emits declarations to `dist/`.
