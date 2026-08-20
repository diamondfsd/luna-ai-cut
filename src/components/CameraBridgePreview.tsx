import { useEffect, useRef, useState } from 'react'
import { Video } from 'lucide-react'

import type { CameraBridgeFrame } from '../shared/types'

type Props = {
  receiving: boolean
  transportError: string | null
}

type VideoConfigPayload = {
  codec?: string
  width?: number
  height?: number
  csd0?: string
  csd1?: string
}

const EMPTY_MESSAGE = '等待视频流'
const VIDEO_CONFIG_TYPE = 2
const VIDEO_TYPE = 3
const KEYFRAME_FLAG = 1

export function CameraBridgePreview({ receiving, transportError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decoderRef = useRef<VideoDecoder | null>(null)
  const configRef = useRef<{ width: number; height: number } | null>(null)
  const [rendered, setRendered] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    function closeDecoder(): void {
      const decoder = decoderRef.current
      decoderRef.current = null
      configRef.current = null
      if (!decoder || decoder.state === 'closed') return
      try { decoder.close() } catch { /* The decoder may already be closed by Chromium. */ }
    }

    function configureDecoder(payload: Uint8Array): void {
      try {
        const config = JSON.parse(new TextDecoder().decode(payload)) as VideoConfigPayload
        const width = config.width ?? 0
        const height = config.height ?? 0
        if (width <= 0 || height <= 0) throw new Error('视频尺寸无效')
        if (typeof VideoDecoder === 'undefined') throw new Error('当前桌面环境不支持 H.264 预览')

        const csd0 = config.csd0 ? decodeBase64(config.csd0) : null
        const csd1 = config.csd1 ? decodeBase64(config.csd1) : null
        const sps = findNalUnit(csd0, 7) ?? findNalUnit(csd1, 7)
        const pps = findNalUnit(csd1, 8) ?? findNalUnit(csd0, 8)
        if (!sps || !pps) throw new Error('视频参数缺少 SPS/PPS')

        const description = buildAvcDecoderConfigurationRecord(csd0, sps, pps)
        const codec = config.codec?.startsWith('avc1.') ? config.codec : h264CodecString(sps)
        closeDecoder()
        const decoder = new VideoDecoder({
          output: (frame) => {
            if (disposed) {
              frame.close()
              return
            }
            const canvas = canvasRef.current
            const context = canvas?.getContext('2d')
            if (!canvas || !context) {
              frame.close()
              return
            }
            const target = configRef.current ?? { width, height }
            canvas.width = target.width
            canvas.height = target.height
            context.drawImage(frame, 0, 0, target.width, target.height)
            frame.close()
            setRendered(true)
            setDecodeError(null)
          },
          error: (error) => {
            if (!disposed) {
              setRendered(false)
              setDecodeError(error.message || 'H.264 视频解码失败')
            }
          },
        })
        decoder.configure({ codec, codedWidth: width, codedHeight: height, description })
        decoderRef.current = decoder
        configRef.current = { width, height }
        setRendered(false)
        setDecodeError(null)
      } catch (error) {
        closeDecoder()
        if (!disposed) setDecodeError(error instanceof Error ? error.message : String(error))
      }
    }

    function handleFrame(frame: CameraBridgeFrame): void {
      if (frame.type === VIDEO_CONFIG_TYPE) {
        configureDecoder(frame.payload)
        return
      }
      if (frame.type !== VIDEO_TYPE) return
      const decoder = decoderRef.current
      if (!decoder || decoder.state !== 'configured') return
      const isKeyframe = (frame.flags & KEYFRAME_FLAG) !== 0
      if (!isKeyframe && decoder.decodeQueueSize > 4) return
      try {
        const data = annexBToAvcc(frame.payload)
        if (data.byteLength === 0) return
        decoder.decode(new EncodedVideoChunk({
          type: isKeyframe ? 'key' : 'delta',
          timestamp: Number(frame.timestampUs),
          data,
        }))
      } catch (error) {
        if (!disposed) setDecodeError(error instanceof Error ? error.message : String(error))
      }
    }

    const unsubscribe = window.luna.cameraBridge.onFrame(handleFrame)
    return () => {
      disposed = true
      unsubscribe()
      closeDecoder()
    }
  }, [])

  const message = decodeError ?? transportError ?? (receiving ? '正在准备桌面预览' : EMPTY_MESSAGE)
  const showOverlay = !rendered || Boolean(decodeError) || Boolean(transportError)

  return (
    <>
      <canvas ref={canvasRef} className="camera-bridge-video-canvas" aria-label="实时视频预览" />
      {showOverlay && (
        <div className="camera-bridge-preview-empty">
          <Video size={36} strokeWidth={1.5} />
          <strong>{decodeError || transportError ? '预览暂不可用' : rendered ? '正在接收视频流' : message}</strong>
          <span>{message}</span>
        </div>
      )}
    </>
  )
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function h264CodecString(sps: Uint8Array): string {
  if (sps.length < 4) throw new Error('SPS 参数无效')
  return `avc1.${[sps[1], sps[2], sps[3]].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function findNalUnit(data: Uint8Array | null, nalType: number): Uint8Array | null {
  if (!data) return null
  const units = splitAnnexB(data)
  if (units.length > 0) return units.find((unit) => (unit[0] & 0x1f) === nalType) ?? null
  if (data[0] === 1 && nalType === 7) return avcConfigSps(data)
  return null
}

function buildAvcDecoderConfigurationRecord(csd0: Uint8Array | null, sps: Uint8Array, pps: Uint8Array): Uint8Array {
  if (csd0?.[0] === 1) return csd0
  const record = new Uint8Array(11 + sps.length + pps.length)
  record.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1], 0)
  new DataView(record.buffer).setUint16(6, sps.length)
  record.set(sps, 8)
  record[8 + sps.length] = 1
  new DataView(record.buffer).setUint16(9 + sps.length, pps.length)
  record.set(pps, 11 + sps.length)
  return record
}

function avcConfigSps(data: Uint8Array): Uint8Array | null {
  if (data.length < 8) return null
  const spsLength = (data[6] << 8) | data[7]
  if (8 + spsLength > data.length) return null
  return data.slice(8, 8 + spsLength)
}

function annexBToAvcc(data: Uint8Array): Uint8Array {
  const units = splitAnnexB(data)
  if (units.length === 0) return data
  const totalLength = units.reduce((total, unit) => total + 4 + unit.length, 0)
  const output = new Uint8Array(totalLength)
  const view = new DataView(output.buffer)
  let offset = 0
  for (const unit of units) {
    view.setUint32(offset, unit.length)
    offset += 4
    output.set(unit, offset)
    offset += unit.length
  }
  return output
}

function splitAnnexB(data: Uint8Array): Uint8Array[] {
  const starts: Array<{ index: number; length: number }> = []
  for (let index = 0; index < data.length - 2; index += 1) {
    if (data[index] !== 0 || data[index + 1] !== 0) continue
    if (data[index + 2] === 1) {
      starts.push({ index, length: 3 })
      index += 2
    } else if (data[index + 2] === 0 && data[index + 3] === 1) {
      starts.push({ index, length: 4 })
      index += 3
    }
  }
  if (starts.length === 0) return []
  return starts.map((start, index) => {
    let end = index + 1 < starts.length ? starts[index + 1].index : data.length
    while (end > start.index + start.length && data[end - 1] === 0) end -= 1
    return data.slice(start.index + start.length, end)
  }).filter((unit) => unit.length > 0)
}
