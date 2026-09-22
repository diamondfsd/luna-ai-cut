#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import process from 'node:process'
import { encodeMediaFrame } from './receive-luna-stream.mjs'

function splitAnnexBAccessUnits(data) {
  const starts = []
  for (let index = 0; index + 3 < data.length;) {
    if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
      starts.push(index)
      index += 3
    } else if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 0 && data[index + 3] === 1) {
      starts.push(index)
      index += 4
    } else {
      index += 1
    }
  }
  if (starts.length === 0) return [data]

  const nals = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : data.length
    return data.subarray(start, end)
  })
  const units = []
  let current = []
  for (const nal of nals) {
    const headerLength = nal[2] === 1 ? 3 : 4
    const nalType = (nal[headerLength] >> 1) & 0x3f
    if (nalType === 32 && current.length > 0) {
      units.push(Buffer.concat(current))
      current = []
    }
    current.push(nal)
  }
  if (current.length > 0) units.push(Buffer.concat(current))
  return units
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

async function main() {
  const inputPath = argumentValue('--input', null)
  if (!inputPath) throw new Error('--input <hevc-file> is required')
  const host = argumentValue('--host', '127.0.0.1')
  const port = positiveInteger(argumentValue('--port', '4184'), 'port')
  const intervalMs = Number.parseInt(argumentValue('--interval-ms', '33'), 10)
  const data = await readFile(inputPath)
  const units = splitAnnexBAccessUnits(data)

  const socket = connect({ host, port })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })

  for (const [index, accessUnit] of units.entries()) {
    socket.write(encodeMediaFrame(index, BigInt(Date.now()) * 1_000n, accessUnit))
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  socket.end()
  console.log(`[replay] sent ${units.length} HEVC access units to ${host}:${port}`)
}

try {
  await main()
} catch (error) {
  console.error(`[replay] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
