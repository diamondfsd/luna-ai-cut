import productShowcaseMarkdown from '../prompts/skills/product-showcase.md?raw'
import productUiLaunchMarkdown from '../prompts/skills/product-ui-launch.md?raw'
import type { AiEditingSkill } from './types'

function readFrontmatter(markdown: string): { name: string; description: string; instructions: string } {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  const frontmatter = match?.[1] ?? ''
  const valueFor = (key: string) => frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
  return { name: valueFor('name'), description: valueFor('description'), instructions: match?.[2]?.trim() ?? markdown.trim() }
}

function builtInProductShowcase(): AiEditingSkill {
  const parsed = readFrontmatter(productShowcaseMarkdown)
  return {
    id: 'product-showcase',
    name: parsed.name || 'product-showcase',
    description: parsed.description,
    instructions: parsed.instructions,
    triggers: ['成片', '短视频', '产品更新', '原型', 'UI', '产品展示'],
    toolIds: [
      'analysis.request',
      'analysis.search_transcript',
      'audio.analyze_beats',
      'workspace.apply_edit_program',
    ],
    requiresFinishedVideo: true,
    source: 'built-in',
    enabled: true,
  }
}

function builtInProductUiLaunch(): AiEditingSkill {
  const parsed = readFrontmatter(productUiLaunchMarkdown)
  return {
    id: 'product-ui-launch',
    name: parsed.name || 'product-ui-launch',
    description: parsed.description,
    instructions: parsed.instructions,
    triggers: ['UI重构', 'UI 重构', '挑战一个人做出剪映', '界面短片', '界面成片', '产品原型成片'],
    toolIds: [
      'analysis.request',
      'analysis.search_transcript',
      'audio.analyze_beats',
      'workspace.apply_edit_program',
    ],
    requiresFinishedVideo: true,
    source: 'built-in',
    enabled: true,
  }
}

export const BUILT_IN_AI_EDITING_SKILLS: readonly AiEditingSkill[] = Object.freeze([
  builtInProductUiLaunch(),
  builtInProductShowcase(),
])
