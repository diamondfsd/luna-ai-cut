import assert from "node:assert/strict"
import test from "node:test"

import {
  LUNA_EDITOR_API_VERSION,
  LUNA_EDITOR_PROTOCOL,
  LunaError,
  LoopbackHttpTransport,
  createLunaClient,
} from "../dist/index.js"

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function success(requestId, data = null) {
  return {
    protocol: LUNA_EDITOR_PROTOCOL,
    apiVersion: LUNA_EDITOR_API_VERSION,
    requestId,
    ok: true,
    result: {
      data,
      affectedIds: [],
      createdIds: [],
      removedIds: [],
      warnings: [],
    },
  }
}

test("client sends context in the explicit wire envelope and normalizes the response", async () => {
  let sent
  const transport = new LoopbackHttpTransport({
    endpoint: "http://127.0.0.1/capability",
    fetch: async (_input, init) => {
      sent = JSON.parse(init.body)
      return response(success("req-001", { projectId: "project-001" }))
    },
  })
  const client = createLunaClient({
    transport,
    context: { sessionId: "session-001", projectId: "project-001" },
    requestIdFactory: () => "req-001",
  })

  const result = await client.project.inspect()

  assert.deepEqual(sent, {
    protocol: LUNA_EDITOR_PROTOCOL,
    apiVersion: LUNA_EDITOR_API_VERSION,
    requestId: "req-001",
    name: "project.inspect",
    args: {},
    sessionId: "session-001",
    projectId: "project-001",
  })
  assert.deepEqual(result.data, { projectId: "project-001" })
  assert.equal(result.operationId, "req-001")
})

test("transport rejects a response from another protocol or request", async () => {
  const transport = new LoopbackHttpTransport({
    endpoint: "http://127.0.0.1/capability",
    fetch: async () => response({
      protocol: "other.protocol",
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId: "req-001",
      ok: true,
      result: { data: null },
    }),
  })

  await assert.rejects(
    transport.request({
      protocol: LUNA_EDITOR_PROTOCOL,
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId: "req-002",
      name: "project.inspect",
      args: {},
    }),
    (error) => error instanceof LunaError && error.code === "PROTOCOL_ERROR",
  )
})

test("transport preserves structured host error codes", async () => {
  const transport = new LoopbackHttpTransport({
    endpoint: "http://127.0.0.1/capability",
    fetch: async () => response({
      protocol: LUNA_EDITOR_PROTOCOL,
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId: "req-003",
      ok: false,
      error: {
        code: "REVISION_CONFLICT",
        message: "Project revision changed.",
        retryable: true,
        details: { expectedRevision: "a", actualRevision: "b" },
      },
    }),
  })

  await assert.rejects(
    transport.request({
      protocol: LUNA_EDITOR_PROTOCOL,
      apiVersion: LUNA_EDITOR_API_VERSION,
      requestId: "req-003",
      name: "project.update",
      args: {},
    }),
    (error) => error instanceof LunaError && error.code === "REVISION_CONFLICT" && error.retryable,
  )
})
