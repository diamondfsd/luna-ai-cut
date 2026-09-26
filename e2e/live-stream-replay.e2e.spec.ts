import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { groupAccessUnits, splitNalUnits } from '../src/lib/annexB'
import { expect, test } from './fixtures/lunaElectron'

const require = createRequire(import.meta.url)

function captureFrame(body: Uint8Array, timestampUs: number): Buffer {
  const payloadLength = 9 + body.length
  const frame = Buffer.alloc(12 + payloadLength + 4)
  Buffer.from('UCD2').copy(frame, 0)
  frame[4] = 1
  frame[5] = 12
  frame[6] = 1
  frame.writeUInt32LE(payloadLength, 8)
  frame[12] = 0x20
  frame.writeBigUInt64LE(BigInt(timestampUs), 13)
  Buffer.from(body).copy(frame, 21)
  return frame
}

test('直播控制台可回放采集样本并生成诊断日志', async ({ lunaApp }) => {
  const captureDirectory = path.join(lunaApp.temporaryRoot, 'user-data', 'live-captures')
  await mkdir(captureDirectory, { recursive: true })
  const capturePath = path.join(captureDirectory, 'sample.ucd2')
  const encoded = spawnSync(require('ffmpeg-static') as string, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
    '-frames:v', '12', '-an', '-c:v', 'libx265', '-preset', 'ultrafast',
    '-x265-params', 'pools=1:frame-threads=1:log-level=error',
    '-f', 'hevc', 'pipe:1',
  ], { maxBuffer: 4 * 1024 * 1024 })
  expect(encoded.status, encoded.stderr.toString()).toBe(0)
  const accessUnits = groupAccessUnits(splitNalUnits(encoded.stdout), 'h265')
  expect(accessUnits.length).toBeGreaterThan(2)
  await writeFile(capturePath, Buffer.concat(accessUnits.map((unit, index) => (
    captureFrame(unit.data, 1_000_000 + index * 100_000)
  ))))

  await lunaApp.page.evaluate(() => { window.location.hash = '#/live-console' })
  await expect(lunaApp.page.getByRole('heading', { name: '直播控制台' })).toBeVisible()
  const startButton = lunaApp.page.getByRole('button', { name: '模拟推流', exact: true })
  await expect(startButton).toBeEnabled()
  await startButton.click()

  await expect.poll(async () => lunaApp.page.evaluate(async () => {
    const status = await window.luna.liveStream.replayStatus()
    return status.state === 'running' && status.outputBytes > 0 && status.pullUrl ? status.pullUrl : null
  })).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/stream$/)

  const replayStatus = await lunaApp.page.evaluate(() => window.luna.liveStream.replayStatus())
  expect(replayStatus.capturePath).toBe(capturePath)
  expect(replayStatus.diagnosticsLogPath).toMatch(/\.jsonl$/)
  const logContents = await readFile(replayStatus.diagnosticsLogPath!, 'utf8')
  expect(logContents).toContain('replay-start')

  const response = await fetch(replayStatus.pullUrl!)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('video/mp2t')
  const reader = response.body?.getReader()
  expect(reader).toBeTruthy()
  const firstChunk = await Promise.race([
    reader!.read(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('拉流未返回媒体数据')), 5_000)),
  ])
  expect(firstChunk.done).toBe(false)
  expect(firstChunk.value?.byteLength ?? 0).toBeGreaterThan(0)
  await reader?.cancel()

  await lunaApp.page.getByRole('button', { name: '停止模拟' }).click()
  await expect.poll(() => lunaApp.page.evaluate(async () => (
    (await window.luna.liveStream.replayStatus()).state
  ))).toBe('stopped')
  expect(lunaApp.runtimeErrors).toEqual([])
})
