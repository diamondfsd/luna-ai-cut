export interface LunaEditingSkillDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly resources: readonly string[]
  readonly skill: string
}

const skillModules = import.meta.glob('../../agent-skills/*/SKILL.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const resourceModules = import.meta.glob('../../agent-skills/*/references/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function skillIdFromPath(modulePath: string): string | null {
  const match = modulePath.match(/\/([^/]+)\/SKILL\.md$/)
  return match?.[1] ?? null
}

function resourcePathFromModule(modulePath: string, skillId: string): string | null {
  const marker = `/agent-skills/${skillId}/`
  const index = modulePath.lastIndexOf(marker)
  return index >= 0 ? modulePath.slice(index + marker.length) : null
}

function frontmatterValue(frontmatter: string, key: 'name' | 'description'): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) return null
  const value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function parseSkill(modulePath: string, raw: string): LunaEditingSkillDefinition | null {
  const id = skillIdFromPath(modulePath)
  if (!id) return null
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error(`Skill ${id} is missing YAML frontmatter`)
  const name = frontmatterValue(match[1], 'name')
  const description = frontmatterValue(match[1], 'description')
  if (!name || !description) throw new Error(`Skill ${id} requires name and description frontmatter`)
  if (name !== id) throw new Error(`Skill folder ${id} must match frontmatter name ${name}`)
  const resources = Object.keys(resourceModules)
    .map((resourceModulePath) => resourcePathFromModule(resourceModulePath, id))
    .filter((resource): resource is string => Boolean(resource))
    .sort((left, right) => left.localeCompare(right, 'en'))
  return {
    id,
    name,
    description,
    resources,
    skill: match[2].trim(),
  }
}

const skills = Object.entries(skillModules)
  .map(([modulePath, raw]) => parseSkill(modulePath, raw))
  .filter((skill): skill is LunaEditingSkillDefinition => skill !== null)
  .sort((left, right) => left.id.localeCompare(right.id, 'en'))

const skillById = new Map(skills.map((skill) => [skill.id, skill]))

export const LUNA_EDITING_SKILL_INDEX = `# Luna AI Cut Editing Skill Index

Call list_editing_skills first. Load luna-core plus the 1-3 scene skills whose descriptions match the user's task. Do not rely on a single generic skill when a scene skill applies.

Available skills:
${skills.map((skill) => `- ${skill.id}: ${skill.description}`).join('\n')}

When a selected SKILL.md links to a reference, load only the relevant reference with get_editing_skill_resource.
`

export function getLunaEditingSkillDefinitions(): readonly LunaEditingSkillDefinition[] {
  return skills
}

export function getLunaEditingSkillDefinition(skillId: string): LunaEditingSkillDefinition | null {
  return skillById.get(skillId) ?? null
}

export function resolveLunaEditingSkills(ids?: readonly string[]): LunaEditingSkillDefinition[] {
  const requested = (ids?.length ? ids : ['luna-core'])
    .map((id) => id.trim())
    .filter(Boolean)
  const unique = new Set<string>(['luna-core', ...requested])
  return [...unique]
    .map((id) => skillById.get(id))
    .filter((skill): skill is LunaEditingSkillDefinition => skill !== undefined)
}

export function getLunaEditingSkillResource(skillId: string, resourcePath: string): string | null {
  const skill = skillById.get(skillId)
  if (!skill || !skill.resources.includes(resourcePath)) return null
  return resourceModules[`../../agent-skills/${skillId}/${resourcePath}`] ?? null
}
