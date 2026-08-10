import { execFile } from 'node:child_process'

import type { AiSelectionSession } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'

export async function createAiSelectionPersonAvatar(
  session: AiSelectionSession,
  groupId: string,
  itemId: string,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const group = session.faceGroups.find((candidate) => candidate.id === groupId)
  const item = session.items.find((candidate) => candidate.id === itemId)
  if (!group || !item || item.kind !== 'image' || !group.itemIds.includes(itemId)) throw new Error('请选择当前人物的照片')
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (!values.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0
    || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
    throw new Error('头像选区无效，请重新选择')
  }
  const filter = `crop=iw*${bounds.width}:ih*${bounds.height}:iw*${bounds.x}:ih*${bounds.y},scale=256:256:flags=lanczos`
  const avatar = await new Promise<Buffer>((resolve, reject) => {
    execFile(getFfmpegPath(), ['-v', 'error', '-i', item.path, '-frames:v', '1', '-vf', filter, '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1'], {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) reject(new Error('头像生成失败，请重新选择'))
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    })
  })
  if (avatar.byteLength === 0 || avatar.byteLength > 512 * 1024) throw new Error('头像生成失败，请重新选择')
  return `data:image/jpeg;base64,${avatar.toString('base64')}`
}
