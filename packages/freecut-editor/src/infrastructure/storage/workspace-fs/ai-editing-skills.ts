import { createLogger } from '@freecut/shared/logging/logger'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { aiEditingSkillsPath } from './paths'
import { requireWorkspaceRoot } from './root'

const logger = createLogger('WorkspaceFS:AiEditingSkills')
const VERSION = 1

export interface StoredAiEditingCustomSkill {
  id: string
  name: string
  description: string
  instructions: string
  triggers: string[]
  enabled: boolean
}

export interface AiEditingSkillsSettings {
  disabledBuiltInIds: string[]
  customSkills: StoredAiEditingCustomSkill[]
}

interface AiEditingSkillsFile extends AiEditingSkillsSettings {
  version: typeof VERSION
}

const EMPTY_SETTINGS: AiEditingSkillsSettings = { disabledBuiltInIds: [], customSkills: [] }

function shortText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : null
}

function sanitizeCustomSkill(value: unknown): StoredAiEditingCustomSkill | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<StoredAiEditingCustomSkill>
  const id = shortText(candidate.id, 80)
  const name = shortText(candidate.name, 80)
  const description = shortText(candidate.description, 280)
  const instructions = shortText(candidate.instructions, 4_000)
  const triggers = Array.isArray(candidate.triggers)
    ? candidate.triggers.map((item) => shortText(item, 40)).filter((item): item is string => item !== null).slice(0, 12)
    : []
  if (!id || !name || !description || !instructions || triggers.length === 0) return null
  return { id, name, description, instructions, triggers, enabled: candidate.enabled !== false }
}

function sanitizeSettings(value: unknown): AiEditingSkillsSettings {
  if (!value || typeof value !== 'object') return EMPTY_SETTINGS
  const candidate = value as Partial<AiEditingSkillsFile>
  if (candidate.version !== VERSION) return EMPTY_SETTINGS
  const disabledBuiltInIds = Array.isArray(candidate.disabledBuiltInIds)
    ? candidate.disabledBuiltInIds.map((id) => shortText(id, 80)).filter((id): id is string => id !== null)
    : []
  const customSkills = Array.isArray(candidate.customSkills)
    ? candidate.customSkills.map(sanitizeCustomSkill).filter((skill): skill is StoredAiEditingCustomSkill => skill !== null)
    : []
  return { disabledBuiltInIds: [...new Set(disabledBuiltInIds)], customSkills }
}

export async function loadAiEditingSkills(): Promise<AiEditingSkillsSettings> {
  try {
    return sanitizeSettings(await readJson<unknown>(requireWorkspaceRoot(), aiEditingSkillsPath()))
  } catch (error) {
    logger.warn('loadAiEditingSkills failed', error)
    return EMPTY_SETTINGS
  }
}

export async function saveAiEditingSkills(settings: AiEditingSkillsSettings): Promise<void> {
  try {
    const sanitized = sanitizeSettings({ ...settings, version: VERSION })
    await writeJsonAtomic(requireWorkspaceRoot(), aiEditingSkillsPath(), { version: VERSION, ...sanitized })
  } catch (error) {
    logger.error('saveAiEditingSkills failed', error)
    throw new Error('Failed to save AI editing skills')
  }
}
