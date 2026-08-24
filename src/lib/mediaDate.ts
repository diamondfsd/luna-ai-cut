const GROUP_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseMediaGroupDate(group: string): Date | null {
  const match = GROUP_DATE_PATTERN.exec(group)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null
  return date
}

export function formatMediaGroupTitle(group: string, includeYear = false): string {
  const date = parseMediaGroupDate(group)
  if (!date) return '未知日期'

  const dateText = new Intl.DateTimeFormat('zh-CN', {
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'long',
    day: 'numeric',
  }).format(date)
  const weekdayText = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return `${dateText} ${weekdayText}`
}
