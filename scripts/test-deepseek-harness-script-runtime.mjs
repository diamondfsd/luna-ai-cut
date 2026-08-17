import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { runEditScript } from './deepseek-harness-script-runtime.mjs'

const requests = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  requests.push(body)
  const result = body.name === 'media.list'
    ? { ok: true, message: '素材已读取。', data: { items: [{ id: 'media-1', mediaType: 'video' }] } }
    : { ok: true, message: '批量添加完成。', data: { createdItemIds: ['item-1'] } }
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
} finally {
  await new Promise((resolve) => server.close(resolve))
}

console.log('DeepSeek Harness editing script runtime passed.')
