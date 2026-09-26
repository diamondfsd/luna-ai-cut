import type { LiveStreamOptions } from '../../../src/shared/types'

const INPUT_SAMPLE_RATE = 48_000
const INPUT_CHANNELS = 1
const OUTPUT_AUDIO_CHANNELS = 2

export function buildLiveStreamFfmpegArgs(
  options: LiveStreamOptions,
  hardwareDecoder: string | null = null,
): string[] {
  const enhanceQuality = options.enhanceQuality === true
  const videoFilter = "scale=w='if(gt(iw,ih),1920,-2)':h='if(gt(iw,ih),-2,1920)':flags=lanczos,unsharp=5:5:0.35:5:5:0"
  const videoInputArgs = hardwareDecoder ? ['-hwaccel', hardwareDecoder] : []
  const videoOutputArgs = enhanceQuality
    ? [
        '-vf', videoFilter,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'main',
        '-level:v', '4.1',
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-b:v', '6000k',
        '-maxrate', '6000k',
        '-bufsize', '12000k',
      ]
    : [
        '-c:v', 'copy',
        '-bsf:v', 'setts=pts=N*3000:dts=N*3000:duration=3000:time_base=1/90000,dump_extra=freq=keyframe',
      ]

  // Pipe inputs arrive in real time already; do not apply FFmpeg's -re pacing.
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-thread_queue_size', '64',
    '-probesize', '5000000',
    '-analyzeduration', '2250000',
    ...videoInputArgs,
    '-f', 'hevc',
    '-framerate', '30',
    '-i', 'pipe:0',
    '-thread_queue_size', '32',
    '-probesize', '32',
    '-analyzeduration', '100000',
    '-f', 's16le',
    '-ar', String(INPUT_SAMPLE_RATE),
    '-ac', String(INPUT_CHANNELS),
    '-i', 'pipe:3',
    '-map', '0:v:0',
    '-map', '1:a:0',
    ...videoOutputArgs,
    '-r', '30',
    '-c:a', 'aac',
    '-af', 'aresample=async=1:first_pts=0:min_hard_comp=0.100',
    '-b:a', '128k',
    '-ar', String(INPUT_SAMPLE_RATE),
    '-ac', String(OUTPUT_AUDIO_CHANNELS),
    '-max_interleave_delta', '100000',
    '-mpegts_flags', 'resend_headers+pat_pmt_at_frames',
    '-flush_packets', '1',
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-f', 'mpegts',
    'pipe:1',
  ]
}
