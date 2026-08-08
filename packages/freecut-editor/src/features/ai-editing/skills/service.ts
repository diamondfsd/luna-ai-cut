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

export function selectAiEditingSkill(request: string, skills: readonly AiEditingSkill[]): AiEditingSkill | null {
  const normalized = request.toLocaleLowerCase()
  return skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({ skill, score: skill.triggers.reduce((score, trigger) => score + (normalized.includes(trigger.toLocaleLowerCase()) ? 1 : 0), 0) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))[0]?.skill ?? null
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
  await saveAiEditingSkills({ ...settings, customSkills: [...settings.customSkills, next] })
}

export async function removeAiEditingCustomSkill(id: string): Promise<void> {
  const settings = await loadAiEditingSkills()
  await saveAiEditingSkills({ ...settings, customSkills: settings.customSkills.filter((skill) => skill.id !== id) })
}
