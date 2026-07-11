import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface ColorPresetData {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** 完整的调色参数（JSON 字符串） */
  colorJson: string
}

const PRESETS_DIR = '_color-presets'
const PRESETS_FILE = 'presets.json'

function presetsDir(downloadDir: string): string {
  return path.join(downloadDir, PRESETS_DIR)
}

function presetsJsonPath(downloadDir: string): string {
  return path.join(presetsDir(downloadDir), PRESETS_FILE)
}

async function readPresets(downloadDir: string): Promise<ColorPresetData[]> {
  try {
    const raw = await fs.readFile(presetsJsonPath(downloadDir), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writePresets(downloadDir: string, presets: ColorPresetData[]): Promise<void> {
  await fs.mkdir(presetsDir(downloadDir), { recursive: true })
  await fs.writeFile(presetsJsonPath(downloadDir), JSON.stringify(presets, null, 2), 'utf8')
}

export async function listColorPresets(downloadDir: string): Promise<ColorPresetData[]> {
  return readPresets(downloadDir)
}

export async function saveColorPreset(
  downloadDir: string,
  name: string,
  colorJson: string,
): Promise<ColorPresetData> {
  const presets = await readPresets(downloadDir)
  const existingIndex = presets.findIndex((p) => p.name === name)
  const now = new Date().toISOString()

  let preset: ColorPresetData
  if (existingIndex >= 0) {
    preset = { ...presets[existingIndex], colorJson, updatedAt: now }
    presets[existingIndex] = preset
  } else {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    preset = { id, name, createdAt: now, updatedAt: now, colorJson }
    presets.push(preset)
  }

  await writePresets(downloadDir, presets)
  return preset
}

export async function deleteColorPreset(downloadDir: string, id: string): Promise<void> {
  const presets = (await readPresets(downloadDir)).filter((p) => p.id !== id)
  await writePresets(downloadDir, presets)
}

export async function renameColorPreset(downloadDir: string, id: string, newName: string): Promise<void> {
  const presets = await readPresets(downloadDir)
  const preset = presets.find((p) => p.id === id)
  if (!preset) throw new Error('预设不存在')
  preset.name = newName
  preset.updatedAt = new Date().toISOString()
  await writePresets(downloadDir, presets)
}
