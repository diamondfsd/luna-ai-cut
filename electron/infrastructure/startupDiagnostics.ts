import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { inspect } from 'node:util'

export interface StartupFailureReport {
  diagnostic: string
  logPath: string | null
}

export function saveStartupFailure(error: unknown, context: string, logPaths: string[]): StartupFailureReport {
  const detail = error instanceof Error ? inspect(error, { depth: 5 }) : String(error)
  const diagnostic = `[${new Date().toISOString()}]\n${context}\n${detail}`
  const failures: string[] = []
  for (const logPath of [...new Set(logPaths)]) {
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `${diagnostic}\n${failures.join('\n')}\n`, 'utf8')
      return { diagnostic: `${diagnostic}\n日志：${logPath}`, logPath }
    } catch (writeError) {
      failures.push(`日志写入失败：${logPath}\n${String(writeError)}`)
    }
  }
  return { diagnostic: `${diagnostic}\n${failures.join('\n')}`, logPath: null }
}
