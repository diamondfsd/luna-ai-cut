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

function presetsDir(baseDir: string): string {
  return path.join(baseDir, PRESETS_DIR)
}

function presetsJsonPath(baseDir: string): string {
  return path.join(presetsDir(baseDir), PRESETS_FILE)
}

async function readPresets(baseDir: string): Promise<ColorPresetData[]> {
  try {
    const raw = await fs.readFile(presetsJsonPath(baseDir), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writePresets(baseDir: string, presets: ColorPresetData[]): Promise<void> {
  await fs.mkdir(presetsDir(baseDir), { recursive: true })
  await fs.writeFile(presetsJsonPath(baseDir), JSON.stringify(presets, null, 2), 'utf8')
}

export async function listColorPresets(baseDir: string): Promise<ColorPresetData[]> {
  return readPresets(baseDir)
}

export async function saveColorPreset(
  baseDir: string,
  name: string,
  colorJson: string,
): Promise<ColorPresetData> {
  const presets = await readPresets(baseDir)
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

  await writePresets(baseDir, presets)
  return preset
}

export async function deleteColorPreset(baseDir: string, id: string): Promise<void> {
  const presets = (await readPresets(baseDir)).filter((p) => p.id !== id)
  await writePresets(baseDir, presets)
}

export async function renameColorPreset(baseDir: string, id: string, newName: string): Promise<void> {
  const presets = await readPresets(baseDir)
  const preset = presets.find((p) => p.id === id)
  if (!preset) throw new Error('预设不存在')
  preset.name = newName
  preset.updatedAt = new Date().toISOString()
  await writePresets(baseDir, presets)
}
