import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { LiveStreamCaptureReplay } from '../electron/media/live-stream/liveStreamCaptureReplay.ts'

const require = createRequire(import.meta.url)
const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--')
const capturePath = cliArgs.find((arg) => !arg.startsWith('--'))
const showHelp = cliArgs.includes('--help')

if (!capturePath || showHelp) {
  process.stdout.write('Usage: pnpm run replay:live-stream -- <capture.ucd2> [--once] [--enhance-quality]\n')
  process.exitCode = showHelp ? 0 : 2
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const diagnosticsLogPath = join(dirname(capturePath), `live-stream-replay-${stamp}.jsonl`)
  const player = new LiveStreamCaptureReplay({
    capturePath,
    diagnosticsLogPath,
    ffmpegPath: require('ffmpeg-static'),
    loop: !cliArgs.includes('--once'),
    enhanceQuality: cliArgs.includes('--enhance-quality'),
    onLog: (level, event, details) => {
      if (level !== 'info') process.stderr.write(`[${event}] ${JSON.stringify(details)}\n`)
    },
  })
  const stop = () => { void player.stop() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  const status = await player.start()
  process.stdout.write(`OBS stream: ${status.pullUrl}\n`)
  process.stdout.write(`Replaying ${status.capturePath}${cliArgs.includes('--once') ? '' : ' (looping)'}\n`)
  process.stdout.write(`Diagnostics: ${status.diagnosticsLogPath}\n`)
  await player.waitForCompletion()
  const finalStatus = player.status()
  process.stdout.write(`Replayed video frames: ${finalStatus.videoFrames}, audio frames: ${finalStatus.audioFrames}\n`)
  if (finalStatus.error) throw new Error(finalStatus.error)
}
