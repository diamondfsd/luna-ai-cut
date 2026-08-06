import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { OperationQueue } from './lib/operation-queue.mjs'
import { PageSession } from './lib/page-session.mjs'
import { renderJob } from './lib/render-core.mjs'

const never = () => new Promise(() => {})

function fakeBrowser(pageFactory = () => ({ evaluate: async () => 'ok' })) {
  const contexts = []
  return {
    contexts,
    async newContext() {
      const generation = contexts.length + 1
      const page = {
        on() {},
        async exposeBinding() {},
        async goto() {},
        async waitForFunction() {},
        ...pageFactory(generation),
      }
      const context = {
        page,
        closed: false,
        async newPage() {
          return page
        },
        async close() {
          this.closed = true
        },
      }
      contexts.push(context)
      return context
    },
  }
}

test('normal operation completes without recovery', async () => {
  let recoveries = 0
  const queue = new OperationQueue({
    maxQueueDepth: 1,
    recover: async () => {
      recoveries++
    },
  })
  assert.equal(await queue.enqueue(async () => 42, { timeoutMs: 100, kind: 'edit' }), 42)
  assert.equal(recoveries, 0)
})

test('never-resolving evaluation times out and recreates the page', async () => {
  const browser = fakeBrowser(() => ({ evaluate: never }))
  const session = new PageSession({ browser, harnessUrl: 'http://harness' })
  await session.open()
  const queue = new OperationQueue({ maxQueueDepth: 1, recover: () => session.recreate() })
  await assert.rejects(
    queue.enqueue(() => session.page.evaluate(), { timeoutMs: 20, kind: 'edit' }),
    (error) => error.code === 'OPERATION_TIMEOUT',
  )
  assert.equal(browser.contexts.length, 2)
  assert.equal(browser.contexts[0].closed, true)
})

test('missing render download is covered by the whole-operation deadline', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-queue-test-'))
  const page = {
    waitForEvent: never,
    evaluate: async () => ({ warnings: [] }),
  }
  let recovered = false
  const queue = new OperationQueue({
    maxQueueDepth: 1,
    recover: async () => {
      recovered = true
    },
  })
  const job = {
    outPath: path.join(outDir, 'missing.webm'),
    missing: [],
    media: [],
    project: {},
    settings: {},
    hasRange: false,
    inPoint: null,
    outPoint: null,
  }
  try {
    await assert.rejects(
      queue.enqueue(() => renderJob(page, job, { downloadTimeoutMs: 0 }), {
        timeoutMs: 20,
        kind: 'render',
      }),
      (error) => error.code === 'OPERATION_TIMEOUT',
    )
    assert.equal(recovered, true)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('page crash is recovered before the next operation uses a fresh page', async () => {
  const browser = fakeBrowser((generation) => ({
    evaluate:
      generation === 1
        ? async () => {
            throw new Error('page crashed')
          }
        : async () => generation,
  }))
  const session = new PageSession({ browser, harnessUrl: 'http://harness' })
  await session.open()
  const queue = new OperationQueue({ maxQueueDepth: 1, recover: () => session.recreate() })
  await assert.rejects(
    queue.enqueue(() => session.page.evaluate(), { timeoutMs: 100, kind: 'edit' }),
    (error) => error.code === 'BROWSER_OPERATION_FAILED',
  )
  assert.equal(
    await queue.enqueue(() => session.page.evaluate(), { timeoutMs: 100, kind: 'edit' }),
    2,
  )
})

test('queue rejects work beyond the configured waiting depth', async () => {
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const queue = new OperationQueue({ maxQueueDepth: 1, recover: async () => {} })
  const first = queue.enqueue(() => blocked, { timeoutMs: 500, kind: 'edit' })
  const second = queue.enqueue(async () => 2, { timeoutMs: 500, kind: 'edit' })
  assert.throws(
    () => queue.enqueue(async () => 3, { timeoutMs: 500, kind: 'edit' }),
    (error) => error.code === 'QUEUE_FULL' && error.statusCode === 429,
  )
  release(1)
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
})

test('shutdown drains idle and active queues and rejects new work', async () => {
  const idle = new OperationQueue({ maxQueueDepth: 1, recover: async () => {} })
  await idle.shutdown(100)
  assert.throws(
    () => idle.enqueue(async () => {}, { timeoutMs: 100 }),
    (error) => error.code === 'SERVICE_SHUTTING_DOWN',
  )

  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const active = new OperationQueue({ maxQueueDepth: 1, recover: async () => {} })
  const operation = active.enqueue(() => blocked, { timeoutMs: 500, kind: 'render' })
  const draining = active.shutdown(200)
  release('done')
  assert.equal(await operation, 'done')
  await draining
  assert.equal(active.accepting, false)
})
