/** Return a local-calendar date key for daily background tasks. */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shouldRunDailyCheck(lastCheckedDate: string | null | undefined, now: Date = new Date()): boolean {
  return lastCheckedDate !== localDateKey(now)
}
