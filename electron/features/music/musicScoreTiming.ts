import { readFile } from 'node:fs/promises'
import type { GeneratedMusicTiming } from '../../../src/shared/types/aiEditor'

/** Read the exact MIDI used by the synthesizer, rather than detecting its waveform. */
export function timingFromMidi(bytes: Buffer, duration: number): GeneratedMusicTiming {
  if (bytes.toString('ascii', 0, 4) !== 'MThd' || bytes.readUInt32BE(4) !== 6) throw new Error('音乐曲谱无效')
  const division = bytes.readUInt16BE(12)
  if (!division || division & 0x8000) throw new Error('音乐曲谱时间无效')
  let position = 14
  let tempo = 0
  let numerator = 4
  let denominator = 4
  const hits: { tick: number; pitch: number; velocity: number }[] = []
  const tracks = bytes.readUInt16BE(10)
  for (let track = 0; track < tracks; track++) {
    if (bytes.toString('ascii', position, position + 4) !== 'MTrk') throw new Error('音乐曲谱轨道无效')
    const end = position + 8 + bytes.readUInt32BE(position + 4)
    position += 8
    if (end > bytes.length) throw new Error('音乐曲谱不完整')
    let tick = 0
    let runningStatus = 0
    const variable = () => {
      let value = 0
      for (let count = 0; count < 4 && position < end; count++) {
        const byte = bytes[position++]
        value = (value << 7) | (byte & 0x7f)
        if (!(byte & 0x80)) return value
      }
      throw new Error('音乐曲谱时间无效')
    }
    while (position < end) {
      tick += variable()
      let status = bytes[position]
      if (status & 0x80) { position++; runningStatus = status }
      else status = runningStatus
      if (status === 0xff) {
        const kind = bytes[position++]
        const length = variable()
        if (position + length > end) throw new Error('音乐曲谱不完整')
        if (kind === 0x51 && length === 3) {
          const nextTempo = bytes.readUIntBE(position, 3)
          if (tick !== 0 || (tempo && tempo !== nextTempo)) throw new Error('音乐曲谱速度变化暂不支持')
          tempo = nextTempo
        }
        if (kind === 0x58 && length === 4) {
          if (tick !== 0) throw new Error('音乐曲谱拍号变化暂不支持')
          numerator = bytes[position]; denominator = 2 ** bytes[position + 1]
        }
        position += length
        runningStatus = 0
      } else if (status === 0xf0 || status === 0xf7) {
        const length = variable()
        position += length; runningStatus = 0
        if (position > end) throw new Error('音乐曲谱不完整')
      } else if (status >= 0x80 && status < 0xf0) {
        const kind = status >> 4
        const length = kind === 0xc || kind === 0xd ? 1 : 2
        if (position + length > end) throw new Error('音乐曲谱不完整')
        if (kind === 0x9 && (status & 0xf) === 9 && bytes[position + 1] > 0) {
          hits.push({ tick, pitch: bytes[position], velocity: bytes[position + 1] })
        }
        position += length
      } else throw new Error('音乐曲谱事件无效')
    }
  }
  if (!tempo || !Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('音乐曲谱速度无效')
  const secondsPerBeat = tempo / 1_000_000
  const barDuration = secondsPerBeat * numerator * 4 / denominator
  const beatTimes = Array.from({ length: Math.ceil(duration / secondsPerBeat) }, (_, index) => index * secondsPerBeat).filter(time => time < duration)
  const downbeats = Array.from({ length: Math.ceil(duration / barDuration) }, (_, index) => index * barDuration).filter(time => time < duration)
  return {
    source: 'generated-score', bpm: 60 / secondsPerBeat, duration,
    beatTimes, downbeats,
    percussionHits: hits.map(hit => ({ time: hit.tick / division * secondsPerBeat, pitch: hit.pitch, velocity: hit.velocity })).filter(hit => hit.time < duration),
  }
}

export async function readGeneratedMusicTiming(filePath: string): Promise<GeneratedMusicTiming | undefined> {
  try {
    const value = JSON.parse(await readFile(`${filePath}.timing.json`, 'utf8')) as GeneratedMusicTiming
    if (value.source !== 'generated-score' || !Number.isFinite(value.bpm) || value.bpm <= 0 ||
        !Number.isFinite(value.duration) || value.duration <= 0 ||
        !Array.isArray(value.beatTimes) || !value.beatTimes.length ||
        !value.beatTimes.every(time => Number.isFinite(time) && time >= 0 && time < value.duration) ||
        !Array.isArray(value.downbeats) || !Array.isArray(value.percussionHits)) return undefined
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
