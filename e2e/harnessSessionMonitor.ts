import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface RawSessionEvent {
  type?: string
  seq?: number
  time?: number
  seq0?: number
  time0?: number
  data?: Record<string, unknown>
}

export interface HarnessSessionLog {
  sessionId: string
  path: string
  mtimeMs: number
  size: number
}

export interface HarnessPendingCall {
  callId: string
  name?: string
  turn?: number
  step?: number
  startedAt?: number
  seq?: number
}

export interface HarnessSessionSnapshot {
  sessionId: string
  logPath: string
  lastSeq?: number
  lastEventType?: string
  lastEventAt?: number
  lastActivityAt: number
  currentStep?: { turn: number; step: number }
  openStep?: { turn: number; step: number }
  openStepStartedAt?: number
  openStepLastAssistantEventAt?: number
  pendingCalls: HarnessPendingCall[]
  firstAssistantEventAt?: number
  firstContentAt?: number
  lastAssistantEventAt?: number
  lastToolCallAt?: number
  lastToolResultAt?: number
  turnEndReason?: string
  errors: string[]
  toolErrors: string[]
  recentEvents: Array<{
    seq?: number
    time?: number
    type: string
    turn?: number
    step?: number
    callId?: string
    name?: string
    chunkType?: string
  }>
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function eventSeq(event: RawSessionEvent): number | undefined {
  return numberField(event.seq) ?? numberField(event.seq0)
}

function eventTime(event: RawSessionEvent): number | undefined {
  return numberField(event.time) ?? numberField(event.time0)
}

function eventData(event: RawSessionEvent): Record<string, unknown> {
  return event.data ?? {}
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function toolResultError(data: Record<string, unknown>): string | undefined {
  const message = objectField(data.message)
  const blocks = message?.content
  if (!Array.isArray(blocks)) return undefined
  const errorBlock = blocks.find((block) => objectField(block)?.isError === true)
  const error = objectField(errorBlock)
  if (!error) return undefined
  const nested = Array.isArray(error.content) ? error.content : []
  const text = nested
    .map((block) => stringField(objectField(block)?.text))
    .find((value): value is string => value !== undefined)
  return text ?? '工具返回错误'
}

function eventCallId(data: Record<string, unknown>): string | undefined {
  const direct = stringField(data.callId)
  if (direct !== undefined) return direct
  const message = data.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  const source = (message as Record<string, unknown>).source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
  return stringField((source as Record<string, unknown>).callId)
}

async function readLogText(log: HarnessSessionLog): Promise<string> {
  if (log.path.endsWith('.jsonl')) return readFile(log.path, 'utf8')
  const result = await execFileAsync('zstd', ['-dc', log.path], {
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'utf8',
  })
  return result.stdout
}

async function readEvents(log: HarnessSessionLog): Promise<RawSessionEvent[]> {
  const text = await readLogText(log)
  const events: RawSessionEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as RawSessionEvent
      if (typeof value.type === 'string') events.push(value)
    } catch {
      // A concurrently written final frame/line is not usable evidence yet.
    }
  }
  return events
}

export async function listHarnessSessionLogs(root: string): Promise<HarnessSessionLog[]> {
  const projects = await readdir(root, { withFileTypes: true }).catch(() => [])
  const logs: HarnessSessionLog[] = []
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const sessionsRoot = path.join(root, project.name)
    const sessions = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
    for (const session of sessions) {
      if (!session.isDirectory() || !session.name.startsWith('session-')) continue
      const sessionRoot = path.join(sessionsRoot, session.name)
      const candidates = ['session.jsonl.zstd', 'session.jsonl']
      for (const filename of candidates) {
        const logPath = path.join(sessionRoot, filename)
        try {
          const metadata = await stat(logPath)
          logs.push({
            sessionId: session.name.slice('session-'.length),
            path: logPath,
            mtimeMs: metadata.mtimeMs,
            size: metadata.size,
          })
          break
        } catch {
          // Try the other supported encoding.
        }
      }
    }
  }
  return logs
}

export async function waitForHarnessSessionLog(
  root: string,
  before: ReadonlyMap<string, number>,
  startedAt: number,
  timeoutMs = 90_000,
): Promise<HarnessSessionLog> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = (await listHarnessSessionLogs(root))
      .filter((log) => !before.has(log.path) || log.mtimeMs > (before.get(log.path) ?? 0) || log.mtimeMs >= startedAt)
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    if (candidates[0]) return candidates[0]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等待 Harness 会话日志超时: ${root}`)
}

export async function inspectHarnessSession(log: HarnessSessionLog): Promise<HarnessSessionSnapshot> {
  const events = await readEvents(log)
  const openSteps = new Map<string, { turn: number; step: number; startedAt?: number }>()
  const pendingCalls: HarnessPendingCall[] = []
  const errors: string[] = []
  const toolErrors: string[] = []
  let currentStep: { turn: number; step: number } | undefined
  let firstAssistantEventAt: number | undefined
  let firstContentAt: number | undefined
  let lastAssistantEventAt: number | undefined
  let lastToolCallAt: number | undefined
  let lastToolResultAt: number | undefined
  let turnEndReason: string | undefined

  for (const event of events) {
    const data = eventData(event)
    const turn = numberField(data.turn)
    const step = numberField(data.step)
    const timestamp = eventTime(event)
    const key = turn !== undefined && step !== undefined ? `${turn}:${step}` : undefined
    if (event.type === 'step/start' && turn !== undefined && step !== undefined) {
      openSteps.set(key!, { turn, step, startedAt: timestamp })
      currentStep = { turn, step }
    }
    if (event.type === 'step/end' && key) openSteps.delete(key)

    if (event.type === 'assistant/chunk') {
      lastAssistantEventAt = timestamp ?? lastAssistantEventAt
      if (firstAssistantEventAt === undefined) firstAssistantEventAt = timestamp
      const chunk = data.chunk
      const chunkType = chunk && typeof chunk === 'object' && !Array.isArray(chunk)
        ? stringField((chunk as Record<string, unknown>).type)
        : undefined
      if (chunkType === 'text-delta' || chunkType === 'reasoning-delta' || chunkType === 'tool-call-delta') {
        if (firstContentAt === undefined) firstContentAt = timestamp
      }
    }
    if (event.type === 'tool/call') {
      const callId = eventCallId(data) ?? '<missing-call-id>'
      pendingCalls.push({
        callId,
        name: stringField(data.name),
        turn,
        step,
        startedAt: timestamp,
        seq: eventSeq(event),
      })
      lastToolCallAt = timestamp ?? lastToolCallAt
    }
    if (event.type === 'tool/result') {
      const callId = eventCallId(data) ?? '<missing-call-id>'
      const pendingIndex = pendingCalls.findIndex((call) => call.callId === callId)
      if (pendingIndex >= 0) pendingCalls.splice(pendingIndex, 1)
      const error = toolResultError(data)
      if (error) toolErrors.push(error)
      lastToolResultAt = timestamp ?? lastToolResultAt
    }
    if (event.type === 'turn/end') {
      const reason = data.reason
      turnEndReason = reason && typeof reason === 'object' && !Array.isArray(reason)
        ? stringField((reason as Record<string, unknown>).kind)
        : stringField(reason)
      if (turnEndReason === 'error' || turnEndReason === 'aborted' || turnEndReason === 'interrupted') {
        errors.push(`turn ${String(turn ?? '?')} ended with ${turnEndReason}`)
      }
    }
    if (event.type === 'agent/error' || event.type === 'connection/error') {
      const message = stringField(data.message) ?? stringField(data.error) ?? event.type
      errors.push(message)
    }
  }

  const lastEvent = events.at(-1)
  const lastEventAt = lastEvent ? eventTime(lastEvent) : undefined
  const fileActivityAt = Math.max(log.mtimeMs, lastEventAt ?? 0)
  const openStep = [...openSteps.values()].at(-1)
  const openStepLastAssistantEventAt = openStep
    ? events.reduce<number | undefined>((latest, event) => {
      if (event.type !== 'assistant/chunk') return latest
      const data = eventData(event)
      if (data.turn !== openStep.turn || data.step !== openStep.step) return latest
      return eventTime(event) ?? latest
    }, undefined)
    : undefined
  const recentEvents = events.slice(-24).map((event) => {
    const data = eventData(event)
    const chunk = data.chunk
    const chunkType = chunk && typeof chunk === 'object' && !Array.isArray(chunk)
      ? stringField((chunk as Record<string, unknown>).type)
      : undefined
    return {
      seq: eventSeq(event),
      time: eventTime(event),
      type: event.type ?? 'unknown',
      turn: numberField(data.turn),
      step: numberField(data.step),
      callId: eventCallId(data),
      name: stringField(data.name),
      chunkType,
    }
  })

  return {
    sessionId: log.sessionId,
    logPath: log.path,
    lastSeq: lastEvent ? eventSeq(lastEvent) : undefined,
    lastEventType: lastEvent?.type,
    lastEventAt,
    lastActivityAt: fileActivityAt,
    currentStep,
    openStep,
    openStepStartedAt: openStep?.startedAt,
    openStepLastAssistantEventAt,
    pendingCalls,
    firstAssistantEventAt,
    firstContentAt,
    lastAssistantEventAt,
    lastToolCallAt,
    lastToolResultAt,
    turnEndReason,
    errors,
    toolErrors,
    recentEvents,
  }
}

export async function formatHarnessSessionDiagnostics(log: HarnessSessionLog): Promise<string> {
  return JSON.stringify(await inspectHarnessSession(log), null, 2)
}
