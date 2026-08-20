import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

function skillRootCandidates() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  return [
    path.resolve(moduleDirectory, '../packages/freecut-editor/src/features/ai-editing/skills/built-in'),
    path.resolve(moduleDirectory, 'skills/built-in'),
  ]
}

function parseSkillMarkdown(raw, filePath) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)([\s\S]*)$/)
  if (!match) throw new Error(`内置技能缺少 YAML frontmatter：${filePath}`)

  const metadata = parseYaml(match[1])
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`内置技能 frontmatter 格式无效：${filePath}`)
  }
  const name = metadata.name
  const description = metadata.description
  if (typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim()) {
    throw new Error(`内置技能必须包含 name 和 description：${filePath}`)
  }
  return {
    name: name.trim(),
    description: description.trim(),
    content: match[2].trim(),
  }
}

async function readSkill(root, relativePath) {
  const filePath = path.join(root, relativePath)
  return parseSkillMarkdown(await readFile(filePath, 'utf8'), filePath)
}

async function markdownFiles(root, relativeDirectory = '') {
  const directory = path.join(root, relativeDirectory)
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(root, relativePath))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relativePath)
  }
  return files.sort()
}

async function readSharedDocuments(root) {
  const files = await markdownFiles(root, 'shared')
  return Promise.all(files.map(async relativePath => ({
    path: relativePath,
    content: (await readFile(path.join(root, relativePath), 'utf8')).trim(),
  })))
}

function withRuntimeMetadata(skill) {
  return {
    ...skill,
    source: 'bundled',
    provider: 'luna-freecut-built-in',
    resourceBase: {
      kind: 'opaque',
      description: 'Luna AI Cut 随应用发布的内置剪辑提示词资源。',
    },
  }
}

/**
 * Load the checked-in prompt assets from either the source tree or the copied
 * packaged runtime tree. The plugin registers the result as runtime skills so
 * Harness can expose one catalog regardless of the current project directory.
 */
export async function loadBuiltInSkills() {
  const root = skillRootCandidates().find(candidate => existsSync(path.join(candidate, 'master/SKILL.md')))
  if (root === undefined) {
    throw new Error('Luna AI Cut 内置剪辑技能资源缺失，请重新构建 Harness 运行时。')
  }

  const skillFiles = (await markdownFiles(root)).filter(relativePath => path.basename(relativePath) === 'SKILL.md')
  if (skillFiles.length === 0) throw new Error('Luna AI Cut 内置剪辑技能目录为空。')
  const parsed = await Promise.all(skillFiles.map(async relativePath => readSkill(root, relativePath)))
  const duplicateNames = parsed
    .map(skill => skill.name)
    .filter((name, index, names) => names.indexOf(name) !== index)
  if (duplicateNames.length > 0) {
    throw new Error(`Luna AI Cut 内置技能名称重复：${[...new Set(duplicateNames)].join(', ')}`)
  }
  const shared = await readSharedDocuments(root)
  const master = parsed.find(skill => skill.name === 'luna-editing-master')
  if (master === undefined) throw new Error('Luna AI Cut 内置剪辑大师技能缺失。')

  const sharedInstructions = [
    '## Harness 已加载的通用剪辑契约',
    '',
    '以下共享资料是本技能的通用执行依据。它们已经随本次技能加载，不需要通过项目路径再次寻找。',
    '',
    ...shared.flatMap(({ content }, index) => [
      content,
      ...(index < shared.length - 1 ? ['', '---', ''] : []),
    ]),
  ].join('\n')

  return parsed.map(skill => withRuntimeMetadata({
    ...skill,
    content: `${skill.content}${skill.name === master.name ? `\n\n${sharedInstructions}` : ''}`,
  }))
}

export async function loadSharedPrompt() {
  const root = skillRootCandidates().find(candidate => existsSync(path.join(candidate, 'master/SKILL.md')))
  if (root === undefined) throw new Error('Luna AI Cut 内置剪辑技能资源缺失，请重新构建 Harness 运行时。')
  const shared = await readSharedDocuments(root)
  return shared.map(({ content }) => content).join('\n\n---\n\n')
}

export async function registerBuiltInSkills(ctx) {
  const skills = await loadBuiltInSkills()
  for (const skill of skills) ctx.skills.register(skill)
  return skills.map(skill => skill.name)
}
