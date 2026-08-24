import * as path from 'node:path'

import type { LunaFile } from '../../../src/shared/types'

const ALLOWED_CAMERA_ROOTS = [
  '/storage_internal/DCIM/',
  '/sdcard/DCIM/',
  '/DCIM/',
]

function expectedHostName(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    throw new Error('相机地址无效，请检查连接设置')
  }
}

function cameraPathFromUrl(urlText: string, host: string): string {
  let url: URL
  try {
    url = new URL(urlText)
  } catch {
    throw new Error('素材地址无效，请刷新相机素材后重试')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('素材地址不是相机可访问地址')
  }
  if (url.hostname !== expectedHostName(host)) {
    throw new Error('素材不属于当前连接的相机')
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('素材路径无效，请刷新相机素材后重试')
  }
  if (decoded.includes('\0') || decoded.endsWith('/')) {
    throw new Error('素材路径无效')
  }
  const normalized = path.posix.normalize(decoded)
  if (normalized !== decoded || !ALLOWED_CAMERA_ROOTS.some((root) => normalized.startsWith(root))) {
    throw new Error('素材路径不在相机媒体目录中')
  }
  return normalized
}

/** 展开一个媒体卡片对应的原文件、低清预览和 Live Photo 动态部分。 */
export function cameraPathsForFile(file: LunaFile, host: string): string[] {
  const urls = [file.sourceUrl, file.previewUrl, file.livePhotoVideoUrl]
    .filter((value): value is string => Boolean(value))
  return [...new Set(urls.map((url) => cameraPathFromUrl(url, host)))]
}

export function cameraPathsForFiles(files: LunaFile[], host: string): string[] {
  return [...new Set(files.flatMap((file) => cameraPathsForFile(file, host)))]
}
