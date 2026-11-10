import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'
import type { PreviewLayer, RenderColorAdjustments } from '../../src/shared/types'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '../..')

export const sampleJpegPath = path.join(projectRoot, 'test-data', 'color-masking', 'd3-effect-set', 'images', 'person', 'person-04.jpg')

export async function createTestVideo(videoPath: string, durationSeconds: number): Promise<void> {
  if (!ffmpegPath) throw new Error('FFmpeg is unavailable')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=24',
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])
}

export async function createMotionPhoto(videoPath: string, motionPhotoPath: string): Promise<void> {
  const jpeg = await readFile(sampleJpegPath)
  const video = await readFile(videoPath)
  if (jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) throw new Error('JPEG fixture has no EOI marker')
  if (video.indexOf(Buffer.from('ftyp')) < 4) throw new Error('MP4 fixture has no ftyp box')
  await writeFile(motionPhotoPath, Buffer.concat([jpeg, video]))
}

export async function createTestLut(lutPath: string): Promise<void> {
  await writeFile(lutPath, [
    'TITLE "Luna E2E Warm Shift"',
    'LUT_3D_SIZE 2',
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    '0.08 0.02 0.00',
    '0.08 0.02 1.00',
    '0.08 1.00 0.00',
    '0.08 1.00 1.00',
    '1.00 0.02 0.00',
    '1.00 0.02 1.00',
    '1.00 1.00 0.00',
    '1.00 1.00 1.00',
    '',
  ].join('\n'), 'utf8')
}

export function createRenderColor(): RenderColorAdjustments {
  return {
    exposure: 0.35,
    black: 0,
    brightness: 0,
    contrast: 14,
    saturation: 12,
    vibrance: 5,
    temperature: 4,
    tint: -2,
    highlights: -8,
    shadows: 10,
    whites: 0,
    blacks: -3,
    clarity: 0,
    texture: 0,
    sharpen: 0,
    denoise: 0,
    skinSmoothing: 0,
    glowStrength: 0,
    glowRadius: 35,
    glowThreshold: 65,
    gradeShadowsHue: 220,
    gradeShadowsAmount: 0,
    gradeMidHue: 35,
    gradeMidAmount: 0,
    gradeHighlightsHue: 42,
    gradeHighlightsAmount: 0,
    curveLift: 0,
    curveContrast: 0,
    curve: { rgb: [], luminance: [], red: [], green: [], blue: [] },
    levelsBlack: 0,
    levelsGray: 0.5,
    levelsWhite: 1,
    hslChannels: [],
  }
}

export function createRenderLayer(filePath: string, options: { video?: boolean; lutPath?: string; color?: RenderColorAdjustments } = {}): PreviewLayer {
  return {
    filePath,
    isVideo: options.video ?? false,
    fit: 'cover',
    dstX: 0,
    dstY: 0,
    dstW: 1,
    dstH: 1,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    opacity: 1,
    zIndex: 0,
    ...(options.color ? { color: options.color } : {}),
    ...(options.lutPath ? { lutId: options.lutPath, lutIntensity: 72 } : {}),
  }
}
