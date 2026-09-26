import { app } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { LiveStreamReplayStatus } from '../../../src/shared/types'
import type { LiveStreamOptions } from '../../../src/shared/types'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { logMainError, logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { getLiveStreamStatus } from './liveStreamService'
import { LiveStreamCaptureReplay } from './liveStreamCaptureReplay'

let replay: LiveStreamCaptureReplay | null = null
let lastDiagnosticsLogPath: string | null = null

function captureDirectory(): string {
  return join(app.getPath('userData'), 'live-captures')
}

function latestCapturePath(): string | null {
  const directory = captureDirectory()
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.ucd2'))
      .map((name) => join(directory, name))
      .filter((path) => {
        try { return statSync(path).isFile() && statSync(path).size > 0 } catch { return false }
      })
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? null
  } catch {
    return null
  }
}

function emptyStatus(capturePath: string | null): LiveStreamReplayStatus {
  return {
    state: 'idle',
    capturePath,
    pullUrl: null,
    diagnosticsLogPath: lastDiagnosticsLogPath,
    startedAt: null,
    videoFrames: 0,
    audioFrames: 0,
    outputBytes: 0,
    videoInputBufferedBytes: 0,
    audioInputBufferedBytes: 0,
    maxPlaybackLagMs: 0,
    activeClients: 0,
    totalConnections: 0,
    totalDisconnections: 0,
    publishedBytes: 0,
    droppedBytesNoClient: 0,
    droppedBytesBackpressure: 0,
    error: null,
  }
}

export async function getLiveStreamReplayStatus(): Promise<LiveStreamReplayStatus> {
  if (replay) return replay.status()
  const current = await getLiveStreamStatus()
  return emptyStatus(current.capturePath && existsSync(current.capturePath)
    ? current.capturePath
    : latestCapturePath())
}

export async function startLiveStreamReplay(options: LiveStreamOptions = {}): Promise<LiveStreamReplayStatus> {
  if (replay?.status().state === 'running' || replay?.status().state === 'starting') {
    return replay.status()
  }

  const liveStatus = await getLiveStreamStatus()
  if (liveStatus.captureActive) throw new Error('请先停止采集，再开始模拟推流')
  const capturePath = liveStatus.capturePath && existsSync(liveStatus.capturePath)
    ? liveStatus.capturePath
    : latestCapturePath()
  if (!capturePath) throw new Error('没有可回放的采集样本')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const diagnosticsLogPath = join(captureDirectory(), `live-stream-replay-${stamp}.jsonl`)
  lastDiagnosticsLogPath = diagnosticsLogPath
  replay = new LiveStreamCaptureReplay({
    capturePath,
    diagnosticsLogPath,
    ffmpegPath: getFfmpegPath(),
    loop: true,
    enhanceQuality: options.enhanceQuality === true,
    onLog: (level, event, details) => {
      const message = `[直播回放] ${event}`
      if (level === 'error') logMainError(message, details)
      else if (level === 'warn') logMainWarn(message, details)
      else logMainInfo(message, details)
    },
  })
  try {
    return await replay.start()
  } catch (error) {
    replay = null
    throw error
  }
}

export async function stopLiveStreamReplay(): Promise<LiveStreamReplayStatus> {
  return replay ? replay.stop() : getLiveStreamReplayStatus()
}

export async function stopLiveStreamReplayOnQuit(): Promise<void> {
  await replay?.stop().catch((error: unknown) => {
    logMainWarn('[直播回放] 退出时停止失败', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
  replay = null
}
