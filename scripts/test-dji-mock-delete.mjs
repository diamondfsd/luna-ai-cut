/* global Buffer */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import { request } from 'node:http'

import { buildDjiDeletePayload } from '../electron/devices/dji/djiDeleteCodec.ts'
import { decodeDjiMessage, encodeDjiMessage } from '../electron/devices/dji/djiBytes.ts'

const root = await mkdtemp(path.join(tmpdir(), 'luna-dji-delete-'))
const httpPort = 18182
const udpPort = 19182
const tcpPort = 17182
const cameraPath = 'DCIM/DJI_001/clip.JPG'
const filePath = path.join(root, 'sdcard', 'clip.JPG')
let child

function udpPacket(frame, sessionId = 1, sequence = 1) {
  const routing = Buffer.alloc(12)
  const payload = Buffer.concat([routing, frame])
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x8000 | (8 + payload.length), 0)
  header.writeUInt16LE(sessionId, 2)
  header.writeUInt16LE(sequence, 4)
  header[6] = 0x05
  header[7] = header.subarray(0, 7).reduce((sum, value) => sum ^ value, 0)
  return Buffer.concat([header, payload])
}

function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'HEAD' }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode))
    })
    req.once('error', reject)
    req.end()
  })
}

async function sendDelete(handle) {
  const socket = dgram.createSocket('udp4')
  const requestFrame = encodeDjiMessage({
    target: 0x0102,
    id: 0x8026,
    flags: 0x40,
    cmdSet: 0x00,
    cmdId: 0x28,
    payload: buildDjiDeletePayload([handle], 1),
  })
  const response = new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.once('message', (data) => {
      const decoded = decodeDjiMessage(data, 20)
      if (!decoded) reject(new Error('mock 返回了无法解析的 DUML 删除响应'))
      else resolve(decoded.message)
    })
  })
  await new Promise((resolve, reject) => {
    socket.send(udpPacket(requestFrame), udpPort, '127.0.0.1', (error) => error ? reject(error) : resolve())
  })
  const message = await response
  socket.close()
  return message
}

try {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, 'mock media')
  child = spawn(process.execPath, [
    'dji_mock_server/server.mjs', '--model', 'pocket4', '--root', root,
    '--http-port', String(httpPort), '--udp-port', String(udpPort), '--tcp-port', String(tcpPort),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('"event":"ready"')) resolve()
    })
    child.once('error', reject)
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  })
  await ready

  assert.equal(await httpStatus(`http://127.0.0.1:${httpPort}/v2?storage=0&path=${cameraPath}`), 200)
  const deleted = await sendDelete(0x00100000)
  assert.equal(deleted.cmdSet, 0x00)
  assert.equal(deleted.cmdId, 0x28)
  assert.equal(deleted.payload.readUInt16LE(0), 0x0000)
  assert.equal(await httpStatus(`http://127.0.0.1:${httpPort}/v2?storage=0&path=${cameraPath}`), 404)

  const missing = await sendDelete(0x00100000)
  assert.equal(missing.payload.readUInt16LE(0), 0x00d6)
} finally {
  if (child && !child.killed) {
    child.kill('SIGTERM')
    await once(child, 'close')
  }
  await rm(root, { recursive: true, force: true })
}

console.log('DJI mock delete integration test passed')
