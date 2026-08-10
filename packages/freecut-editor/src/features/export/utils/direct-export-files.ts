import type { EmbeddedExportFile } from '@freecut/shared/host/embedded-host'
import type { ClientRenderResult } from './client-renderer'

function extensionForMimeType(mimeType: string): string {
  const mime = mimeType.toLowerCase()
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('matroska')) return 'mkv'
  if (mime.includes('quicktime') || mime.includes('mov')) return 'mov'
  if (mime.includes('audio/mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('audio/wav') || mime.includes('wave')) return 'wav'
  if (mime.includes('audio/aac') || mime.includes('adts')) return 'aac'
  return 'mp4'
}

function safeStem(value: string | undefined): string {
  const cleaned = (value ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'FreeCut 导出'
}

function timestampSuffix(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function buildDirectExportFiles(
  result: ClientRenderResult,
  projectName: string | undefined,
  now = new Date(),
): EmbeddedExportFile[] {
  const baseName = `${safeStem(projectName)}-${timestampSuffix(now)}`
  const files: EmbeddedExportFile[] = [{
    fileName: `${baseName}.${extensionForMimeType(result.mimeType)}`,
    data: result.blob,
  }]
  if (result.subtitleSidecar) {
    const extension = result.subtitleSidecar.filename.split('.').pop() || 'srt'
    files.push({
      fileName: `${baseName}.${extension}`,
      data: new Blob([result.subtitleSidecar.content], { type: 'text/plain;charset=utf-8' }),
    })
  }
  return files
}
