import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function createDefaultPreviewSource(ffmpeg = 'ffmpeg') {
  const { stdout } = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
    '-t', '1', '-an', '-c:v', 'libx264', '-threads', '1',
    '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
    '-g', '1', '-x264-params', 'aud=1:repeat-headers=1', '-f', 'h264', 'pipe:1',
  ], { encoding: 'buffer', timeout: 15000, maxBuffer: 4 * 1024 * 1024 })
  // FFmpeg emits Annex-B access-unit delimiters; keep complete encoded frames.
  const boundaries = []
  for (let index = 0; index + 4 < stdout.length; index += 1) {
    if (stdout[index] !== 0 || stdout[index + 1] !== 0) continue
    const prefix = stdout[index + 2] === 1 ? 3
      : stdout[index + 2] === 0 && stdout[index + 3] === 1 ? 4 : 0
    if (!prefix) continue
    if ((stdout[index + prefix] & 0x1f) === 9) boundaries.push(index)
    index += prefix - 1
  }
  if (!boundaries.length) throw new Error('Mock preview encoder returned no video frames')
  boundaries[0] = 0
  return boundaries.map((start, index) => stdout.subarray(start, boundaries[index + 1] ?? stdout.length))
}
