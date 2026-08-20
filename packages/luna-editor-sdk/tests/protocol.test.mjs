import assert from 'node:assert/strict'
import test from 'node:test'

const PROTOCOL = 'luna.editor'
const AGENT_PROTOCOL = 'luna.editor.agent'
const API_VERSION = 1
const REVISION = /^sha256:[0-9a-f]{64}$/
const JOB_STATUSES = [
  'queued',
  'running',
  'paused',
  'canceling',
  'completed',
  'failed',
  'canceled',
  'interrupted',
]

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertClientRequest(request) {
  assert.deepEqual(Object.keys(request).sort(), [
    'apiVersion',
    'args',
    'name',
    'projectId',
    'protocol',
    'requestId',
    'sessionId',
  ])
  assert.equal(request.protocol, PROTOCOL)
  assert.equal(request.apiVersion, API_VERSION)
  for (const field of ['requestId', 'sessionId', 'projectId', 'name']) {
    assert.equal(typeof request[field], 'string')
    assert.ok(request[field].length > 0)
  }
  assert.equal(typeof request.args, 'object')
  assert.ok(request.args !== null && !Array.isArray(request.args))
  assert.equal('intent' in request, false)
  assert.equal('workflow' in request, false)
  assert.equal('userMessage' in request, false)
  assert.deepEqual(jsonRoundTrip(request), request)
}

function assertEditResponse(response) {
  assert.deepEqual(Object.keys(response).sort(), [
    'apiVersion',
    'ok',
    'protocol',
    'requestId',
    'result',
  ])
  assert.equal(response.protocol, PROTOCOL)
  assert.equal(response.apiVersion, API_VERSION)
  assert.equal(response.ok, true)
  assert.equal(typeof response.requestId, 'string')

  const result = response.result
  assert.deepEqual(Object.keys(result).sort(), [
    'affectedIds',
    'createdIds',
    'data',
    'kind',
    'removedIds',
    'revision',
    'warnings',
  ])
  assert.equal(result.kind, 'edit')
  assert.match(result.revision, REVISION)
  for (const field of ['affectedIds', 'createdIds', 'removedIds', 'warnings']) {
    assert.ok(Array.isArray(result[field]))
  }
  assert.equal(typeof result.data, 'object')
  assert.equal(jsonRoundTrip(response).result.revision, result.revision)
}

function assertErrorResponse(response) {
  assert.deepEqual(Object.keys(response).sort(), [
    'apiVersion',
    'error',
    'ok',
    'protocol',
    'requestId',
  ])
  assert.equal(response.protocol, PROTOCOL)
  assert.equal(response.apiVersion, API_VERSION)
  assert.equal(response.ok, false)
  assert.equal(typeof response.requestId, 'string')
  assert.deepEqual(Object.keys(response.error).sort(), [
    'code',
    'details',
    'message',
    'retryable',
  ])
  assert.match(response.error.code, /^[A-Z][A-Z0-9_]+$/)
  assert.equal(typeof response.error.message, 'string')
  assert.equal(typeof response.error.retryable, 'boolean')
  assert.ok(response.error.details !== null && typeof response.error.details === 'object')
  assert.equal('stack' in response.error, false)
  assert.deepEqual(jsonRoundTrip(response), response)
}

function assertJob(job) {
  const keys = Object.keys(job).sort()
  assert.deepEqual(keys, [
    'apiVersion',
    'createdAt',
    'jobId',
    'jobType',
    'kind',
    'progress',
    'protocol',
    'requestId',
    'status',
    'updatedAt',
  ].concat(job.error ? ['error'] : []).concat(job.result ? ['result'] : []).sort())
  assert.equal(job.protocol, PROTOCOL)
  assert.equal(job.apiVersion, API_VERSION)
  assert.equal(job.kind, 'job')
  assert.ok(JOB_STATUSES.includes(job.status))
  assert.ok(job.progress >= 0 && job.progress <= 1)
  assert.equal(typeof job.jobId, 'string')
  assert.equal(typeof job.jobType, 'string')
  assert.equal(typeof job.requestId, 'string')
  assert.equal(typeof job.createdAt, 'string')
  assert.equal(typeof job.updatedAt, 'string')

  if (job.status === 'completed') {
    assert.equal(job.progress, 1)
    assert.ok(job.result !== undefined)
    assert.equal(job.error, undefined)
  }
  if (job.status === 'failed') {
    assert.ok(job.error !== undefined)
    assert.equal(job.result, undefined)
  }
  assert.deepEqual(jsonRoundTrip(job), job)
}

test('client requests use an explicit JSON capability envelope', () => {
  const request = {
    protocol: PROTOCOL,
    apiVersion: API_VERSION,
    requestId: 'req-001',
    sessionId: 'session-001',
    projectId: 'project-001',
    name: 'timeline.clips.trim',
    args: {
      clipId: 'clip-001',
      edge: 'start',
      amount: { seconds: 1.5 },
      mode: 'ripple',
    },
  }

  assertClientRequest(request)
})

test('edit responses expose structured ids, revision, warnings, and data', () => {
  assertEditResponse({
    protocol: PROTOCOL,
    apiVersion: API_VERSION,
    requestId: 'req-001',
    ok: true,
    result: {
      kind: 'edit',
      revision: `sha256:${'a'.repeat(64)}`,
      affectedIds: ['clip-001', 'clip-002'],
      createdIds: [],
      removedIds: [],
      warnings: [],
      data: null,
    },
  })
})

test('errors remain structured and correlated with the original request', () => {
  assertErrorResponse({
    protocol: PROTOCOL,
    apiVersion: API_VERSION,
    requestId: 'req-001',
    ok: false,
    error: {
      code: 'REVISION_CONFLICT',
      message: 'Project revision changed.',
      retryable: true,
      details: {
        expectedRevision: `sha256:${'b'.repeat(64)}`,
        actualRevision: `sha256:${'c'.repeat(64)}`,
      },
    },
  })
})

test('job payloads cover every public status and terminal result rules', () => {
  for (const status of JOB_STATUSES) {
    const job = {
      protocol: PROTOCOL,
      apiVersion: API_VERSION,
      kind: 'job',
      requestId: `req-${status}`,
      jobId: `job-${status}`,
      jobType: 'render.export',
      status,
      progress: status === 'completed' ? 1 : 0.42,
      createdAt: '2026-08-19T08:00:00.000Z',
      updatedAt: '2026-08-19T08:00:10.000Z',
    }
    if (status === 'completed') job.result = { artifactId: 'artifact-001' }
    if (status === 'failed' || status === 'interrupted') {
      job.error = {
        code: status === 'failed' ? 'RENDER_FAILED' : 'JOB_INTERRUPTED',
        message: 'The job did not finish.',
        retryable: status === 'interrupted',
        details: {},
      }
    }
    assertJob(job)
  }
})

test('user messages survive JSON forwarding without host-authored intent state', () => {
  const original = '你好，Luna！片段 #42 / keep this text exactly.'
  const message = {
    protocol: AGENT_PROTOCOL,
    apiVersion: API_VERSION,
    requestId: 'req-user-001',
    sessionId: 'session-001',
    message: {
      role: 'user',
      content: original,
    },
  }

  const forwarded = jsonRoundTrip(message)
  assert.deepEqual(forwarded, message)
  assert.equal(forwarded.message.content, original)
  assert.equal('intent' in forwarded, false)
  assert.equal('workflow' in forwarded, false)
  assert.equal('completionState' in forwarded, false)
})
