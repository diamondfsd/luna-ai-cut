/**
 * 水印资源路径查找（仅路径解析，不含处理逻辑）
 */
import { app } from 'electron'
import * as path from 'node:path'
import { deviceDefinitions } from './deviceDefaults'

function getWatermarkDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'watermark')
  return path.join(app.getAppPath(), 'src', 'assets', 'watermark')
}

const WATERMARK_FILE_NAMES = new Map<string, { video: string; image: string }>()
for (const device of deviceDefinitions()) {
  for (const ws of device.watermarkStyles ?? []) {
    WATERMARK_FILE_NAMES.set(ws.value, { video: ws.videoFileName, image: ws.imageFileName })
  }
}

export function watermarkFileFor(kind: 'image' | 'video', style: string): string {
  const pair = WATERMARK_FILE_NAMES.get(style)
  if (!pair) throw new Error(`未知水印样式: ${style}`)
  return path.join(getWatermarkDir(), `${pair[kind]}.png`)
}

export function watermarkFileSizeFor(style: string): { width: number; height: number } | null {
  const pair = WATERMARK_FILE_NAMES.get(style)
  if (!pair) return null
  // 前端通过 getWatermarkPath IPC 获取实际尺寸，此函数一般用于后端估算
  return null
}
