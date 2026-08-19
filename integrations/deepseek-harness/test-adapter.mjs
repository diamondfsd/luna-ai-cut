import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { apply, FREECUT_EXPOSED_TOOL_NAMES } from './plugin.mjs'
import { normalizeLunaConfig } from './config.mjs'
import { createCapabilityTransport, createLunaSdk } from './sdk-client.mjs'
import { runEditScript } from './script-runtime.mjs'

const envConfig = normalizeLunaConfig({}, {
  LUNA_ASSISTANT_CAPABILITY_ENDPOINT: 'http://127.0.0.1:1',
  LUNA_ASSISTANT_CAPABILITY_TOKEN: 'legacy-token',
  LUNA_ASSISTANT_PROJECT_ID: 'project-1',
  LUNA_ASSISTANT_SESSION_ID: 'session-1',
  LUNA_ASSISTANT_CWD: process.cwd(),
  LUNA_ASSISTANT_MODEL: 'test-model',
}, { requireModel: true })
assert.deepEqual(envConfig, {
  endpoint: 'http://127.0.0.1:1',
  token: 'legacy-token',
  projectId: 'project-1',
  sessionId: 'session-1',
  cwd: process.cwd(),
  model: 'test-model',
})

const requests = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  requests.push({ body, authorization: request.headers.authorization })

  const result = body.name === 'media.list'
    ? {
        operationId: 'operation-1',
        revision: 'revision-1',
        data: { media: [{ id: 'media-1', mimeType: 'video/mp4', fileName: 'clip.mp4' }], total: 1 },
        affectedIds: ['media-1'],
        createdIds: [],
        removedIds: [],
        warnings: [],
      }
    : {
        ok: true,
        message: 'legacy host result',
        data: { createdItemIds: ['item-1'] },
      }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: true, result }))
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const config = {
  endpoint: `http://127.0.0.1:${String(address.port)}`,
  token: 'test-token',
  projectId: 'project-1',
  sessionId: 'session-1',
  cwd: process.cwd(),
}

try {
  const transport = createCapabilityTransport(config)
  const protocolResult = await transport.call('media.list')
  assert.equal(protocolResult.operationId, 'operation-1')
  assert.equal(protocolResult.revision, 'revision-1')
  await assert.rejects(transport.call('media list'), /capability name is invalid/)
  await assert.rejects(transport.call('media.list', []), /arguments must be an object/)

  const sdk = createLunaSdk(config)
  const genericResult = await sdk.media.list()
  assert.equal(genericResult.operationId, 'operation-1')
  assert.equal(genericResult.data.media[0].id, 'media-1')

  const legacySdk = createLunaSdk(config, { legacyResults: true })
  const legacyResult = await legacySdk.media.list()
  assert.deepEqual(legacyResult.data.items, [{
    id: 'media-1',
    mimeType: 'video/mp4',
    fileName: 'clip.mp4',
    mediaType: 'video',
    name: 'clip.mp4',
  }])
  assert.deepEqual(await legacySdk.timeline.addMedia({ mediaId: 'media-1' }), {
    ok: true,
    message: 'legacy host result',
    data: { createdItemIds: ['item-1'] },
  })

  const scriptResult = await runEditScript(config, {
    code: `
      export default async function main() {
        return {
          hasPath: Object.hasOwn(process.env, 'PATH'),
          sdkToken: process.env.LUNA_SDK_TOKEN,
          legacyToken: process.env.LUNA_SCRIPT_TOKEN,
        }
      }
    `,
  })
  assert.deepEqual(scriptResult.data.result, {
    hasPath: false,
    sdkToken: 'test-token',
    legacyToken: 'test-token',
  })

  const registered = []
  const prompts = []
  const dispose = await apply({
    tools: { register: tool => registered.push(tool) },
    systemPrompt: { section: section => { prompts.push(section); return () => {} } },
  }, { ...config, registerBuiltInSkills: false })
  assert.deepEqual(FREECUT_EXPOSED_TOOL_NAMES, ['edit.run_script'])
  assert.deepEqual(registered.map(tool => tool.name), ['edit.run_script'])
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].text, /edit\.run_script/)
  assert.equal(typeof dispose, 'function')
  dispose()
} finally {
  await new Promise(resolve => server.close(resolve))
}

console.log('DeepSeek Harness adapter protocol tests passed.')
