import type { CompositionInput } from '../../shared/types'

export interface WebGpuVideoExportStartMessage {
  type: 'start'
  bytes: ArrayBuffer
  mimeType: string
  fileName: string
  composition: CompositionInput
  width: number
  height: number
  fps: number | null
  qualityPreset: string
  includeAudio: boolean
}

export interface WebGpuVideoExportCancelMessage {
  type: 'cancel'
}

export type WebGpuVideoExportWorkerMessage = WebGpuVideoExportStartMessage | WebGpuVideoExportCancelMessage

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
  buffer: ArrayBuffer
  duration: number
  frameCount: number
  audioCopied: boolean
}

export interface WebGpuVideoExportErrorMessage {
  type: 'error'
  message: string
  canceled: boolean
}

export type WebGpuVideoExportWorkerResponse =
  | WebGpuVideoExportProgressMessage
  | WebGpuVideoExportDoneMessage
  | WebGpuVideoExportErrorMessage
