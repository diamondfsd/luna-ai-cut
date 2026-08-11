import { TimelineCodingSession } from './timeline-session'

let activeSession: TimelineCodingSession | null = null
let startingSession: Promise<TimelineCodingSession> | null = null
let sessionGeneration = 0

export async function startTimelineCodingSession(): Promise<TimelineCodingSession> {
  if (activeSession || startingSession) throw new Error('已有剪辑代码工作区正在运行。')
  const generation = sessionGeneration
  const pending = TimelineCodingSession.create()
  startingSession = pending
  try {
    const session = await pending
    if (sessionGeneration === generation) activeSession = session
    return session
  } finally {
    if (startingSession === pending) startingSession = null
  }
}

export function getTimelineCodingSession(): TimelineCodingSession {
  if (!activeSession) throw new Error('剪辑代码工作区尚未启动。')
  return activeSession
}

export function clearTimelineCodingSession(session?: TimelineCodingSession): void {
  if (session && activeSession !== session) return
  activeSession = null
  startingSession = null
  sessionGeneration += 1
}
