import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { runEditScript, SCRIPT_API } from './deepseek-harness-script-runtime.mjs'

assert.equal('source' in SCRIPT_API, false)
assert.deepEqual(Object.keys(SCRIPT_API.memory), ['read', 'search', 'update', 'remove'])
assert.deepEqual(Object.keys(SCRIPT_API.media), ['list', 'read', 'analyze', 'getAnalysisTask', 'searchTranscript'])
assert.deepEqual(Object.keys(SCRIPT_API.audio), ['startSpeech', 'startMusic', 'getTask'])
assert.deepEqual(Object.keys(SCRIPT_API.render), [
  'preflight',
  'frame',
  'layout',
  'remotionStart',
  'remotionGetTask',
  'remotionCancel',
  'remotionCreate',
  'remotionList',
  'remotionGet',
  'remotionReadSource',
  'remotionUpdateSource',
  'remotionPreview',
  'remotionRender',
  'remotionAddToTimeline',
])
assert.deepEqual(Object.keys(SCRIPT_API.project), ['inspect', 'update'])
assert.deepEqual(Object.keys(SCRIPT_API.timeline), [
  'inspectContext',
  'addTrack',
  'moveTrack',
  'addMedia',
  'trim',
  'split',
  'move',
  'remove',
  'removeAudio',
  'fitAudioToVisual',
  'unlink',
  'mute',
  'setProperties',
  'setTransform',
  'setAudio',
  'addText',
  'addKeyframe',
  'addTransition',
  'addMediaBatch',
  'effects',
])
assert.deepEqual(Object.keys(SCRIPT_API.timeline.effects), ['add', 'update', 'remove'])
const requests = []
const workerEnvironmentKey = 'LUNA_TEST_SCRIPT_RUNTIME_ENV'
const previousWorkerEnvironment = process.env[workerEnvironmentKey]
process.env[workerEnvironmentKey] = 'preserved'
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  requests.push(body)
  const result = body.name === 'media.list'
    ? { ok: true, message: '素材已读取。', data: { items: [{ id: 'media-1', mediaType: 'video' }] } }
    : body.name === 'project.inspect'
      ? {
          kind: 'data',
          revision: 'sha256:test',
          data: {
            projectId: 'project-1',
            project: { id: 'project-1', name: '测试剪辑项目' },
            timeline: { tracks: [], items: [], transitions: [], keyframes: [] },
            counts: { tracks: 0, items: 0, transitions: 0, keyframes: 0 },
          },
        }
      : body.name === 'timeline.inspect_context'
        ? {
            kind: 'data',
            revision: 'sha256:large-test',
            data: {
              projectId: 'project-1',
              fps: 25,
              tracks: [],
              items: [{ id: 'item-large', label: 'x'.repeat(200_000) }],
              transitions: [],
              keyframes: [],
            },
          }
    : { ok: true, message: '编辑完成。', data: { createdItemIds: ['item-1'] } }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: true, result }))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')

try {
  const result = await runEditScript(
    {
      endpoint: `http://127.0.0.1:${String(address.port)}`,
      token: 'test-token',
      projectId: 'project-1',
      cwd: process.cwd(),
    },
    {
      code: `
        export default async function main(luna) {
          const project = await luna.project.inspect()
          const media = await luna.media.list()
          const selected = []
          for (const item of media.data.items) {
            if (item.mediaType === 'video') selected.push(item.id)
          }
          const created = await luna.timeline.addMediaBatch({
            items: selected.map((mediaId, index) => ({ mediaId, startSeconds: index * 3, durationSeconds: 3 })),
          })
          const track = await luna.timeline.addTrack({ type: 'audio', name: '音乐' })
          const transition = await luna.timeline.addTransition({
            fromClipId: 'clip-a',
            toClipId: 'clip-b',
            type: 'crossfade',
            durationSeconds: 0.5,
          })
          return {
            projectId: project.data.projectId,
            workerEnvironment: process.env.LUNA_TEST_SCRIPT_RUNTIME_ENV,
            selected,
            created: created.data.createdItemIds,
            transition: transition.data.createdItemIds,
          }
        }
      `,
    },
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.result, {
    projectId: 'project-1',
    workerEnvironment: 'preserved',
    selected: ['media-1'],
    created: ['item-1'],
    transition: ['item-1'],
  })
  assert.deepEqual(requests.map((request) => request.name), ['project.inspect', 'media.list', 'timeline.add_media_batch', 'timeline.add_track', 'timeline.add_transition'])
  assert.deepEqual(requests[3].args, { type: 'audio', name: '音乐' })
  assert.deepEqual(requests.at(-1).args, {
    fromClipId: 'clip-a',
    toClipId: 'clip-b',
    type: 'crossfade',
    durationSeconds: 0.5,
  })
  assert.ok(requests.every((request) => request.projectId === 'project-1'))

  const largeResult = await runEditScript(
    {
      endpoint: `http://127.0.0.1:${String(address.port)}`,
      token: 'test-token',
      projectId: 'project-1',
      cwd: process.cwd(),
    },
    {
      code: `
        export default async function main(luna) {
          return await luna.timeline.inspectContext()
        }
      `,
    },
  )
  assert.equal(largeResult.ok, true)
  assert.equal(largeResult.data.result.data.items[0].label.length, 200_000)
} finally {
  await new Promise((resolve) => server.close(resolve))
  if (previousWorkerEnvironment === undefined) delete process.env[workerEnvironmentKey]
  else process.env[workerEnvironmentKey] = previousWorkerEnvironment
}

console.log('DeepSeek Harness editing script runtime passed.')
