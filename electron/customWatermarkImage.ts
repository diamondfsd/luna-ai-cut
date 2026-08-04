import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface WatermarkImageSize {
  width: number
  height: number
}

export async function probeWatermarkImage(filePath: string, ffprobePath: string): Promise<WatermarkImageSize> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  const value = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> }
  const stream = value.streams?.[0]
  const width = stream?.width
  const height = stream?.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height || width <= 0 || height <= 0) {
    throw new Error('无法读取图片尺寸')
  }
  return { width, height }
}

export async function convertWebpWatermarkToPng(
  sourcePath: string,
  destinationPath: string,
  ffmpegPath: string,
): Promise<void> {
  await execFileAsync(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', sourcePath,
    '-map', '0:v:0',
    '-frames:v', '1',
    '-c:v', 'png',
    '-pix_fmt', 'rgba',
    '-f', 'image2',
    '-y',
    destinationPath,
  ], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
}
