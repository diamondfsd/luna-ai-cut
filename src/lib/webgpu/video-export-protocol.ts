import type { CompositionInput } from '../../shared/types'

export interface WebGpuVideoExportSourceMessage {
  path: string
  key: string
  sourceType: 'image' | 'video'
  bytes: ArrayBuffer
  mimeType: string
  fileName: string
}

export interface WebGpuVideoExportLutMessage {
  path: string
  text: string
}

export interface WebGpuVideoExportMaskMessage {
  projectId: string
  path: string
  width: number
  height: number
  bytes: ArrayBuffer
}

export interface WebGpuVideoExportStartMessage {
  type: 'start'
  composition: CompositionInput
  sources: WebGpuVideoExportSourceMessage[]
  luts: WebGpuVideoExportLutMessage[]
  masks: WebGpuVideoExportMaskMessage[]
  width: number
  height: number
  fps: number | null
  qualityPreset: string
  includeAudio: boolean
}

export interface WebGpuVideoExportCancelMessage {
  type: 'cancel'
}

export interface WebGpuVideoExportChunkAckMessage {
  type: 'chunk-ack'
  id: number
  error?: string
}

export type WebGpuVideoExportWorkerMessage =
  | WebGpuVideoExportStartMessage
  | WebGpuVideoExportCancelMessage
  | WebGpuVideoExportChunkAckMessage

export interface WebGpuVideoExportProgressMessage {
  type: 'progress'
  phase: 'preparing' | 'decoding' | 'rendering' | 'encoding' | 'finalizing'
  progress: number
  currentFrame: number
  totalFrames: number
  message: string
}

export interface WebGpuVideoExportDoneMessage {
  type: 'done'
  duration: number
  frameCount: number
  audioCopied: boolean
}

export interface WebGpuVideoExportChunkMessage {
  type: 'chunk'
  id: number
  data: ArrayBuffer
}

export interface WebGpuVideoExportErrorMessage {
  type: 'error'
  message: string
  canceled: boolean
}

export type WebGpuVideoExportWorkerResponse =
  | WebGpuVideoExportProgressMessage
  | WebGpuVideoExportChunkMessage
  | WebGpuVideoExportDoneMessage
  | WebGpuVideoExportErrorMessage
