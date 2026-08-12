import { loadAiEditingSkills, saveAiEditingSkills } from '@freecut/infrastructure/storage'
import { BUILT_IN_AI_EDITING_SKILLS } from './registry'
import type { AiEditingCustomSkillInput, AiEditingSkill } from './types'

function customSkill(input: AiEditingCustomSkillInput, id = crypto.randomUUID()): AiEditingSkill {
  return {
    id,
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: input.instructions.trim(),
    triggers: input.triggers.map((trigger) => trigger.trim()).filter(Boolean),
    toolIds: [],
    requiresFinishedVideo: false,
    source: 'custom',
    enabled: true,
  }
}

export async function listAiEditingSkills(): Promise<AiEditingSkill[]> {
  const settings = await loadAiEditingSkills()
  const disabled = new Set(settings.disabledBuiltInIds)
  return [
    ...BUILT_IN_AI_EDITING_SKILLS.map((skill) => ({ ...skill, enabled: !disabled.has(skill.id) })),
    ...settings.customSkills.map((skill) => ({ ...skill, source: 'custom' as const, toolIds: [], requiresFinishedVideo: false })),
  ]
}

export async function readAiEditingSkill(name: string): Promise<AiEditingSkill | null> {
  const normalized = name.trim().toLocaleLowerCase()
  const matches = (await listAiEditingSkills()).filter(
    (skill) => skill.enabled && skill.name.trim().toLocaleLowerCase() === normalized,
  )
  return matches.length === 1 ? matches[0] ?? null : null
}

export async function updateAiEditingSkillEnabled(id: string, enabled: boolean): Promise<void> {
  const settings = await loadAiEditingSkills()
  const isBuiltIn = BUILT_IN_AI_EDITING_SKILLS.some((skill) => skill.id === id)
  if (isBuiltIn) {
    const disabled = new Set(settings.disabledBuiltInIds)
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    await saveAiEditingSkills({ ...settings, disabledBuiltInIds: [...disabled] })
    return
  }
  await saveAiEditingSkills({
    ...settings,
    customSkills: settings.customSkills.map((skill) => skill.id === id ? { ...skill, enabled } : skill),
  })
}

export async function addAiEditingCustomSkill(input: AiEditingCustomSkillInput): Promise<void> {
  const settings = await loadAiEditingSkills()
  const next = customSkill(input)
  const normalizedName = next.name.toLocaleLowerCase()
  const nameExists = [
    ...BUILT_IN_AI_EDITING_SKILLS,
    ...settings.customSkills,
  ].some((skill) => skill.name.trim().toLocaleLowerCase() === normalizedName)
  if (nameExists) throw new Error('Skill name already exists')
  await saveAiEditingSkills({ ...settings, customSkills: [...settings.customSkills, next] })
}

export async function removeAiEditingCustomSkill(id: string): Promise<void> {
  const settings = await loadAiEditingSkills()
  await saveAiEditingSkills({ ...settings, customSkills: settings.customSkills.filter((skill) => skill.id !== id) })
}
