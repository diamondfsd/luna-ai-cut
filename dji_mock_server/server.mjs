#!/usr/bin/env node
/* global process */
import { pathToFileURL } from 'node:url'
import { MockCameraServer, parseArgs } from './opc/server.js'
import { configureMockLogging } from './logging.mjs'
import { createDefaultPreviewSource } from './previewSource.mjs'

export { MockCameraServer } from './opc/server.js'

export function parseMockArgs(argv) {
  let ffmpeg = 'ffmpeg'
  const args = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--ffmpeg') {
      ffmpeg = argv[++index]
      if (!ffmpeg || ffmpeg.startsWith('--')) throw new Error('--ffmpeg requires a path')
    } else args.push(argv[index])
  }
  // Keep the existing entrypoint and root flag; protocol behavior stays upstream.
  const options = parseArgs([
    '--model', 'pocket4', '--udp-port', '19004', '--tcp-port', '17002',
    '--http-port', '18082', '--json-log',
    ...args.filter((arg) => arg !== '--verbose-log').map((arg) => arg === '--root' ? '--media-root' : arg),
  ])
  return { ...options, verboseLog: args.includes('--verbose-log'), ffmpeg }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let server
  try {
    const options = parseMockArgs(process.argv.slice(2))
    if (options.help) {
      console.log('node dji_mock_server/server.mjs --model pocket4|pocket4pro|pocket3|nano --media-root DIR --video-source FILE [--permissive] [--verbose-log]')
    } else {
      server = new MockCameraServer(options)
      configureMockLogging(server, options.verboseLog)
      if (!options.videoSource) server.videoAUs = await createDefaultPreviewSource(options.ffmpeg)
      const stop = () => { server.stop(); process.exit(0) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      await server.listen()
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    server?.stop()
    process.exitCode = 1
  }
}
