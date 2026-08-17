import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { runEditScript } from './deepseek-harness-script-runtime.mjs'

const requests = []
let audioPolls = 0
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  requests.push(body)
  const result = body.name === 'media.list'
    ? { ok: true, message: '素材已读取。', data: { items: [{ id: 'media-1', mediaType: 'video' }] } }
    : body.name === 'audio.start_music'
      ? { ok: true, message: '音乐任务已提交。', data: { taskId: 'audio-task-1', status: 'queued' } }
      : body.name === 'audio.get_task'
        ? {
            ok: true,
            message: audioPolls++ === 0 ? '音乐任务仍在处理中。' : '音乐任务已完成。',
            data: audioPolls === 1
              ? { taskId: 'audio-task-1', status: 'generating' }
              : { taskId: 'audio-task-1', status: 'completed', mediaId: 'music-1' },
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
          const media = await luna.media.list()
          const selected = []
          for (const item of media.data.items) {
            if (item.mediaType === 'video') selected.push(item.id)
          }
          const created = await luna.timeline.addMediaBatch({
            items: selected.map((mediaId, index) => ({ mediaId, startSeconds: index * 3, durationSeconds: 3 })),
          })
          return { selected, created: created.data.createdItemIds }
        }
      `,
    },
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.result, { selected: ['media-1'], created: ['item-1'] })
  assert.deepEqual(requests.map((request) => request.name), ['media.list', 'timeline.add_media_batch'])
  assert.ok(requests.every((request) => request.projectId === 'project-1'))

  const audioResult = await runEditScript(
    {
      endpoint: `http://127.0.0.1:${String(address.port)}`,
      token: 'test-token',
      projectId: 'project-1',
      cwd: process.cwd(),
    },
    {
      code: `
        export default async function main(luna) {
          const submitted = await luna.audio.startMusic({ prompt: '舒缓的日落氛围音乐', durationSeconds: 8 })
          let task = submitted
          while (task.data.status !== 'completed' && task.data.status !== 'failed') {
            await new Promise((resolve) => setTimeout(resolve, 1))
            task = await luna.audio.getTask({ taskId: submitted.data.taskId })
          }
          if (task.data.status === 'failed') throw new Error(task.data.error || 'audio task failed')
          const added = await luna.timeline.addMedia({ mediaId: task.data.mediaId, startSeconds: 0 })
          return { taskId: submitted.data.taskId, mediaId: task.data.mediaId, added: added.data.createdItemIds }
        }
      `,
    },
  )

  assert.deepEqual(audioResult.data.result, {
    taskId: 'audio-task-1',
    mediaId: 'music-1',
    added: ['item-1'],
  })
  assert.deepEqual(requests.slice(2).map((request) => request.name), [
    'audio.start_music',
    'audio.get_task',
    'audio.get_task',
    'timeline.add_media',
  ])
} finally {
  await new Promise((resolve) => server.close(resolve))
}

console.log('DeepSeek Harness editing script runtime passed.')
