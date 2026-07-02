import exifr from 'exifr'

import type { WorkspaceColorMetadata } from '../src/shared/types'

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = /-?\d+(?:\.\d+)?/.exec(value)
    if (match) {
      const parsed = Number(match[0])
      return Number.isFinite(parsed) ? parsed : null
    }
  }
  return null
}

function firstNumber(values: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numberFrom(values[key])
    if (value !== null) return value
  }
  return null
}

function normalizeWhiteBalance(value: unknown): WorkspaceColorMetadata['whiteBalanceMode'] {
  if (typeof value === 'number') return value === 0 ? 'auto' : 'manual'
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower.includes('auto') || value.includes('自动')) return 'auto'
    if (lower.includes('manual') || value.includes('手动')) return 'manual'
  }
  return 'unknown'
}

function flattenMetadata(value: unknown, output: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value || typeof value !== 'object') return output
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) flattenMetadata(item, output)
    else output[key] = item
  }
  return output
}

export async function readWorkspaceColorMetadata(filePath: string): Promise<WorkspaceColorMetadata> {
  try {
    const parsed = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      ifd1: true,
      xmp: true,
      icc: true,
      mergeOutput: false,
      translateValues: false,
    })
    const values = flattenMetadata(parsed)
    const temperatureKelvin = firstNumber(values, [
      'ColorTemperature',
      'ColorTemp',
      'WhiteBalanceTemperature',
      'CameraTemperature',
    ])
    const tint = firstNumber(values, ['Tint', 'WhiteBalanceTint', 'WBShiftAB', 'WBShiftGM'])
    return {
      whiteBalanceMode: normalizeWhiteBalance(values.WhiteBalance),
      temperatureKelvin: temperatureKelvin && temperatureKelvin >= 1500 && temperatureKelvin <= 50000 ? temperatureKelvin : null,
      tint: tint && Math.abs(tint) <= 100 ? tint : null,
    }
  } catch {
    return {
      whiteBalanceMode: 'unknown',
      temperatureKelvin: null,
      tint: null,
    }
  }
}
