#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import dgram from 'node:dgram'
import path from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index]
  if (value.startsWith('--')) args.set(value, process.argv[index + 1]?.startsWith('--') ? true : process.argv[++index])
}

const rootDir = path.resolve(String(args.get('--root') || process.env.DJI_MOCK_ROOT || '.'))
const requestedModel = args.get('--model')
const model = requestedModel === 'pocket3' || requestedModel === 'pocket4pro' || requestedModel === 'action5pro' ? requestedModel : 'pocket4'
const host = String(args.get('--host') || process.env.DJI_MOCK_HOST || '127.0.0.1')
const httpPort = Number(args.get('--http-port') || process.env.DJI_MOCK_HTTP_PORT || 18080)
const tcpPort = Number(args.get('--tcp-port') || process.env.DJI_MOCK_TCP_PORT || 17001)
const udpPort = Number(args.get('--udp-port') || process.env.DJI_MOCK_UDP_PORT || 19004)
const dropAfterBytes = Math.max(0, Number(args.get('--drop-after-bytes') || process.env.DJI_MOCK_DROP_AFTER_BYTES || 0))
const rateMbps = Math.max(0, Number(args.get('--rate-mbps') || process.env.DJI_MOCK_RATE_MBPS || 30))
const modelData = model === 'pocket4pro'
  ? { name: 'Osmo Pocket 4 Pro', localName: 'OsmoPocket4P-6E55', modelNumber: 34, productType: 218, advert: '000000ee0004bd6e5620da000010' }
  : model === 'action5pro'
    ? { name: 'Osmo Action 5 Pro', localName: 'OsmoAction5Pro-AC204', modelNumber: 21, productType: 235, advert: '000000ee0004bd6e5620eb000010' }
    : model === 'pocket3'
      ? { name: 'Osmo Pocket 3', localName: 'OsmoPocket3', modelNumber: 32, productType: null, advert: '2000' }
      : { name: 'Osmo Pocket 4', localName: 'OsmoPocket4-ACPT', modelNumber: 33, productType: null, advert: '210000be0000ee8dd9a000000000' }
const filesByStorage = [[], []]
const filesByCameraPath = new Map()
const droppedPaths = new Set()
let bleArmed = false
let blePaired = false
let udpSequence = 0

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, model, ...details })}\n`)
}

function u32(value) {
  const result = Buffer.alloc(4)
  result.writeUInt32LE(value >>> 0, 0)
  return result
}

function crc8(data) {
  let crc = 0x77
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0x8c : crc >>> 1
  }
  return crc & 0xff
}

function crc16(data) {
  let crc = 0x3692
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1
  }
  return crc & 0xffff
}

function encodeDuml({ target = 0x0102, id = 0x8000, flags = 0xc0, cmdSet, cmdId, payload = Buffer.alloc(0) }) {
  const length = 13 + payload.length
  const header = Buffer.from([0x55, length & 0xff, 0x04 | ((length >>> 8) & 3), 0])
  header[3] = crc8(header.subarray(0, 3))
  const body = Buffer.alloc(7)
  body.writeUInt16LE(target & 0xffff, 0)
  body.writeUInt16LE(id & 0xffff, 2)
  body[4] = flags & 0xff
  body[5] = cmdSet & 0xff
  body[6] = cmdId & 0xff
  const withoutCrc = Buffer.concat([header, body, payload])
  const checksum = Buffer.alloc(2)
  checksum.writeUInt16LE(crc16(withoutCrc), 0)
  return Buffer.concat([withoutCrc, checksum])
}

function decodeDuml(data, offset = 0) {
  if (offset + 13 > data.length || data[offset] !== 0x55) return null
  const length = data[offset + 1] | ((data[offset + 2] & 3) << 8)
  if ((data[offset + 2] >>> 2) !== 1 || length < 13 || offset + length > data.length) return null
  if (crc8(data.subarray(offset, offset + 3)) !== data[offset + 3]) return null
  const frame = data.subarray(offset, offset + length)
  if (crc16(frame.subarray(0, length - 2)) !== frame.readUInt16LE(length - 2)) return null
  return {
    target: frame.readUInt16LE(4), id: frame.readUInt16LE(6), flags: frame[8], cmdSet: frame[9], cmdId: frame[10],
    payload: Buffer.from(frame.subarray(11, length - 2)),
  }
}

function bleResponse(request, cmdSet, cmdId, payload, flags = 0xc0) {
  return encodeDuml({ target: request.target, id: request.id, flags, cmdSet, cmdId, payload }).toString('hex')
}

function packString(value) {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([Buffer.from([bytes.length]), bytes])
}

function handleBleExchange(frameHex) {
  const request = decodeDuml(Buffer.from(frameHex, 'hex'))
  if (!request || !bleArmed) throw new Error('BLE 尚未执行 fff4 配对准备')
  if (request.cmdSet === 0x07 && request.cmdId === 0x45) {
    const tokenOffset = 1 + (request.payload[0] || 0)
    const tokenLength = request.payload[tokenOffset] || 0
    const token = request.payload.subarray(tokenOffset + 1, tokenOffset + 1 + tokenLength).toString('utf8')
    if (token !== 'osmo') return { framesHex: [bleResponse(request, 0x07, 0x45, Buffer.from([0, 0xe0]))] }
    if (blePaired) return { framesHex: [bleResponse(request, 0x07, 0x45, Buffer.from([0, 1]))] }
    blePaired = true
    return {
      framesHex: [
        bleResponse(request, 0x07, 0x45, Buffer.from([0, 2])),
        bleResponse(request, 0x07, 0x46, Buffer.from([0, 0]), 0x40),
      ],
    }
  }
  if (request.cmdSet === 0x07 && request.cmdId === 0x07) {
    const ssid = `DJI-${modelData.localName}-Mock`
    return { framesHex: [bleResponse(request, 0x07, 0x07, Buffer.concat([Buffer.from([0]), packString(ssid)]))] }
  }
  if (request.cmdSet === 0x07 && request.cmdId === 0x0e) {
    const password = model === 'pocket4pro' ? 'pocket4-pro-mock-pass' : model === 'action5pro' ? 'action5-pro-mock-pass' : model === 'pocket3' ? 'pocket3-mock-pass' : 'pocket4-mock-pass'
    return { framesHex: [bleResponse(request, 0x07, 0x0e, Buffer.concat([Buffer.from([0]), packString(password)]))] }
  }
  if (request.cmdSet === 0x53 && request.cmdId === 0x10) return { framesHex: [bleResponse(request, 0x53, 0x10, Buffer.from([1, 0, 0, 0]))] }
  if (request.cmdSet === 0x00 && request.cmdId === 0x2b) return { framesHex: [bleResponse(request, 0x00, 0x2b, Buffer.from([0]))] }
  return { framesHex: [bleResponse(request, request.cmdSet, request.cmdId, Buffer.from([0, 0]))] }
}

function parseUdp(data) {
  if (data.length < 8) return null
  const total = data.readUInt16LE(0) & 0x3fff
  if (total < 8 || total > data.length) return null
  return { packetType: data[6], sessionId: data.readUInt16LE(2), sequence: data.readUInt16LE(4), payload: data.subarray(8, total) }
}

function udpHeader(packetType, payloadLength, sessionId, sequence) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x8000 | ((8 + payloadLength) & 0x3fff), 0)
  header.writeUInt16LE(sessionId, 2)
  header.writeUInt16LE(sequence, 4)
  header[6] = packetType
  header[7] = header.subarray(0, 7).reduce((sum, value) => sum ^ value, 0)
  return header
}

function sendUdp(socket, address, packetType, frame, sessionId, sequence) {
  const routing = Buffer.alloc(12)
  const packet = Buffer.concat([udpHeader(packetType, routing.length + frame.length, sessionId, sequence), routing, frame])
  socket.send(packet, address.port, address.address)
}

function pathField(subtype, value) {
  const bytes = Buffer.from(value, 'latin1')
  const field = Buffer.alloc(6 + bytes.length)
  field[0] = 0x1a
  field[1] = field.length - 2
  field[5] = subtype
  bytes.copy(field, 6)
  return field
}

function nameField(value) {
  const bytes = Buffer.from(value, 'latin1')
  return Buffer.concat([Buffer.from([0x0d, bytes.length]), bytes])
}

function manifestHandle(storage, index) {
  const handleBase = model === 'action5pro'
    ? (storage === 1 ? 0x40040000 : 0x00040000)
    : storage === 1 ? 0x40100000 : model === 'pocket3' ? 0x00040000 : 0x00100000
  const handleStep = model === 'action5pro' || model === 'pocket3' ? 0x10 : 0x40
  return (handleBase + index * handleStep) >>> 0
}

function manifestFor(storageFiles, storage) {
  const body = [u32(model === 'action5pro' ? 0 : storageFiles.length)]
  for (const [index, file] of storageFiles.entries()) {
    const handle = file.handle ?? manifestHandle(storage, index)
    const head = Buffer.alloc(48)
    head.writeUInt32LE(handle >>> 0, 0)
    head[8] = 0x03
    head[9] = 0xff
    head[10] = 0x19
    head[11] = 0x06
    body.push(head, nameField(file.name), pathField(1, file.cameraPath), pathField(2, file.thumbPath))
  }
  return Buffer.concat(body)
}

function manifestReply(socket, address, request, storage) {
  const data = manifestFor(filesByStorage[storage], storage)
  const counter = request.payload[4] || 1
  const chunks = []
  for (let offset = 0; offset < data.length; offset += 700) chunks.push(data.subarray(offset, offset + 700))
  if (chunks.length === 0) chunks.push(Buffer.alloc(0))
  const subHeader = (kind, sequence, chunk) => Buffer.concat([
    Buffer.from([0x4a, kind, 0x0e, 0x10, counter & 0xff, sequence & 0xff, 0, 0, 0, 0]), chunk,
  ])
  sendUdp(socket, address, 0x05, encodeDuml({ id: request.id, cmdSet: 0x00, cmdId: 0x27, payload: subHeader(0x04, 0, Buffer.alloc(0)) }), request.sessionId, udpSequence++)
  chunks.forEach((chunk, index) => sendUdp(socket, address, 0x05, encodeDuml({ id: request.id, cmdSet: 0x00, cmdId: 0x27, payload: subHeader(0x01, index, chunk) }), request.sessionId, udpSequence++))
  sendUdp(socket, address, 0x05, encodeDuml({ id: request.id, cmdSet: 0x00, cmdId: 0x27, payload: subHeader(0x03, chunks.length, Buffer.alloc(0)) }), request.sessionId, udpSequence++)
  log('manifest', { storage, fileCount: filesByStorage[storage].length, bytes: data.length })
}

function responsePayload(request) {
  if (request.cmdSet === 0x02 && request.cmdId === 0x0c) return Buffer.from([0, 0])
  return Buffer.from([0, 0])
}

async function deleteReply(socket, address, request, sessionId, sequence) {
  const count = request.payload[0] || 0
  const expectedLength = 1 + count * 4
  let status = 0
  let targets = []
  if (count === 0 || request.payload.length < expectedLength) {
    status = 1
  } else {
    const handles = Array.from({ length: count }, (_, index) => request.payload.readUInt32LE(1 + index * 4))
    targets = handles.map((handle) => {
      for (let storage = 0; storage < filesByStorage.length; storage += 1) {
        const index = filesByStorage[storage].findIndex((file) => file.handle === handle)
        if (index >= 0) return { storage, index, entry: filesByStorage[storage][index] }
      }
      return null
    })
    if (targets.some((target) => target === null)) {
      status = 0x00d6
    } else {
      try {
        for (const target of targets) await unlink(target.entry.filePath)
        for (const target of [...targets].sort((a, b) => b.storage - a.storage || b.index - a.index)) {
          filesByStorage[target.storage].splice(target.index, 1)
          filesByCameraPath.delete(`${target.storage}:${target.entry.cameraPath}`)
        }
      } catch {
        status = 1
      }
    }
  }
  sendUdp(
    socket,
    address,
    0x05,
    encodeDuml({ target: request.target, id: request.id, cmdSet: 0x00, cmdId: 0x28, payload: Buffer.from([status & 0xff, (status >>> 8) & 0xff]) }),
    sessionId,
    sequence,
  )
  log('delete', { count, status, deletedCount: status === 0 ? targets.length : 0 })
}

async function handleUdp(socket, data, address) {
  const packet = parseUdp(data)
  if (!packet) return
  if (packet.packetType === 0x00) {
    const payload = packet.payload
    const header = udpHeader(0x00, payload.length, packet.sessionId, packet.sequence)
    socket.send(Buffer.concat([header, payload]), address.port, address.address)
    log('udp-handshake', { remote: `${address.address}:${address.port}` })
    return
  }
  const request = decodeDuml(packet.payload, 12)
  if (!request) return
  if (request.cmdSet === 0x00 && request.cmdId === 0x26) {
    const cursor = request.payload.length >= 14 ? request.payload.readUInt32LE(10) : 1
    manifestReply(socket, address, { ...request, sessionId: packet.sessionId }, (cursor & 0x40000000) !== 0 ? 1 : 0)
    return
  }
  if (request.cmdSet === 0x00 && request.cmdId === 0x28) {
    await deleteReply(socket, address, request, packet.sessionId, udpSequence++)
    return
  }
  sendUdp(socket, address, 0x05, encodeDuml({ target: request.target, id: request.id, cmdSet: request.cmdSet, cmdId: request.cmdId, payload: responsePayload(request) }), packet.sessionId, udpSequence++)
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isMedia(name) {
  return new Set(['jpg', 'jpeg', 'dng', 'heic', 'mp4', 'mov', 'lrf', 'lrv', 'xrf', 'osv', 'insv']).has(extensionOf(name))
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(entryPath))
    else if (entry.isFile() && isMedia(entry.name)) result.push(entryPath)
  }
  return result
}

async function loadStorage(directory, storage) {
  if (!existsSync(directory)) return
  for (const filePath of await walk(directory)) {
    const relative = path.relative(directory, filePath).split(path.sep).join('/')
    const cameraPath = `DCIM/DJI_001/${relative}`
    const entry = { filePath, name: path.basename(filePath), cameraPath, thumbPath: `MISC/THM/${path.basename(filePath, path.extname(filePath))}.JPG`, storage }
    filesByStorage[storage].push(entry)
    filesByCameraPath.set(`${storage}:${cameraPath}`, entry)
  }
}

async function loadFiles() {
  const candidates = {
    sd: ['sdcard', 'sd', 'storage0'],
    internal: ['internal', 'storage_internal', 'storage1'],
  }
  const sdDirectory = candidates.sd.map((name) => path.join(rootDir, name)).find(existsSync)
  const internalDirectory = candidates.internal.map((name) => path.join(rootDir, name)).find(existsSync)
  if (sdDirectory || internalDirectory) {
    await loadStorage(sdDirectory || rootDir, 0)
    if (internalDirectory) await loadStorage(internalDirectory, 1)
  } else {
    await loadStorage(rootDir, model === 'pocket3' ? 0 : 1)
  }
  filesByStorage.forEach((files, storage) => {
    files.sort((a, b) => a.name.localeCompare(b.name))
    files.forEach((file, index) => { file.handle = manifestHandle(storage, index) })
  })
}

function contentType(filePath) {
  const extension = extensionOf(filePath)
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'dng') return 'image/x-adobe-dng'
  if (extension === 'heic') return 'image/heic'
  if (['mp4', 'mov', 'lrf', 'lrv', 'xrf', 'osv', 'insv'].includes(extension)) return 'video/mp4'
  return 'application/octet-stream'
}

async function serveMedia(request, response, url) {
  const storage = Number(url.searchParams.get('storage') || 1)
  const cameraPath = url.searchParams.get('path') || ''
  const entry = filesByCameraPath.get(`${storage}:${cameraPath}`)
  if (!entry) {
    response.writeHead(cameraPath ? 404 : 200)
    response.end(cameraPath ? 'not found' : 'DJI mock service')
    return
  }
  const info = await stat(entry.filePath)
  const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/)
  const start = range ? Number(range[1]) : 0
  const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
  const length = Math.max(0, end - start + 1)
  const headers = { 'Content-Type': contentType(entry.filePath), 'Content-Length': String(length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
  response.writeHead(range ? 206 : 200, headers)
  if (request.method === 'HEAD') { response.end(); return }
  const stream = createReadStream(entry.filePath, { start, end })
  let sent = 0
  stream.on('data', (chunk) => {
    sent += chunk.length
    if (dropAfterBytes > 0 && !droppedPaths.has(cameraPath) && sent >= dropAfterBytes) {
      droppedPaths.add(cameraPath)
      log('simulate-ap-drop', { path: cameraPath, bytes: sent })
      stream.destroy()
      response.destroy()
    }
  })
  stream.on('error', () => response.destroy())
  stream.pipe(response)
}

async function jsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function jsonResponse(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function start() {
  await loadFiles()
  const udp = dgram.createSocket('udp4')
  udp.on('message', (data, address) => {
    void handleUdp(udp, data, address).catch((error) => log('udp-error', { error: error instanceof Error ? error.message : String(error) }))
  })
  await new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(udpPort, host, resolve) })
  const tcp = createTcpServer((socket) => { socket.on('data', () => log('tcp-poke')); setTimeout(() => socket.end(), 50) })
  await new Promise((resolve, reject) => { tcp.once('error', reject); tcp.listen(tcpPort, host, resolve) })
  const http = createHttpServer((request, response) => {
    const url = new URL(request.url || '/', `http://${host}:${httpPort}`)
    if (url.pathname === '/health' || url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ service: 'dji-mock', model, name: modelData.name, udpPort, tcpPort, httpPort }))
      return
    }
    if (url.pathname === '/ble/advertisement') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ companyId: '08aa', localName: modelData.localName, modelNumber: modelData.modelNumber, productType: modelData.productType, payloadHex: modelData.advert, serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb', notifyUuid: '0000fff4-0000-1000-8000-00805f9b34fb', writeUuid: '0000fff5-0000-1000-8000-00805f9b34fb' }))
      return
    }
    if (url.pathname === '/ble/state') { jsonResponse(response, { armed: bleArmed, paired: blePaired, credentialsAvailable: blePaired }); return }
    if (url.pathname === '/ble/arm') { bleArmed = true; jsonResponse(response, { armed: true }); return }
    if (url.pathname === '/ble/confirm') { blePaired = true; jsonResponse(response, { paired: true }); return }
    if (url.pathname === '/ble/exchange') {
      void jsonBody(request).then((body) => jsonResponse(response, handleBleExchange(body.frameHex))).catch((error) => jsonResponse(response, { error: error instanceof Error ? error.message : String(error) }, 400))
      return
    }
    if (url.pathname === '/v2') { void serveMedia(request, response, url); return }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(httpPort, host, resolve) })
  log('ready', { rootDir, udpPort, tcpPort, httpPort, rateMbps, dropAfterBytes, storageCounts: filesByStorage.map((files) => files.length) })
  const stop = () => { udp.close(); tcp.close(); http.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

void start().catch((error) => { console.error(error); process.exit(1) })
