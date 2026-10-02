import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LIVE_USAGE_DAILY_LIMIT = 20

export function createLiveUsageBudget(directory: string, now = () => Date.now()) {
  const file = join(directory, 'live-usage-budget.json')
  let blocked = false

  return {
    reserve(): boolean {
      if (blocked) return false
      try {
        const day = new Date(now()).toISOString().slice(0, 10)
        let previous: { day: string; count: number } = { day, count: 0 }
        try {
          const stored = JSON.parse(readFileSync(file, 'utf8'))
          if (!stored || typeof stored.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stored.day)
            || !Number.isInteger(stored.count) || stored.count < 0 || stored.count > LIVE_USAGE_DAILY_LIMIT) {
            blocked = true
            return false
          }
          previous = stored
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (previous.day > day) return false
        const count = previous.day === day ? previous.count : 0
        if (count >= LIVE_USAGE_DAILY_LIMIT) return false
        mkdirSync(directory, { recursive: true })
        const temporary = `${file}.tmp`
        writeFileSync(temporary, JSON.stringify({ day, count: count + 1 }), { mode: 0o600 })
        renameSync(temporary, file)
        return true
      } catch {
        blocked = true
        return false
      }
    },
  }
}
