import { pathToFileURL } from 'node:url'
import type { LunaFile } from '../src/shared/types'

export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

export function labelsFor(date: Date | null): Pick<LunaFile, 'capturedAt' | 'dateText' | 'timeText' | 'groupDay' | 'groupHour'> {
  if (!date) {
    return {
      capturedAt: null,
      dateText: '未知日期',
      timeText: '未知时间',
      groupDay: '未知日期',
      groupHour: '未知时间',
    }
  }
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  return {
    capturedAt: date.toISOString(),
    dateText: `${year}-${month}-${day}`,
    timeText: `${hour}:${minute}`,
    groupDay: `${year}-${month}-${day}`,
    groupHour: `${year}-${month}-${day} ${hour}:00`,
  }
}

export function localThumbnailUrl(filePath: string): string {
  return pathToFileURL(filePath).toString()
}
