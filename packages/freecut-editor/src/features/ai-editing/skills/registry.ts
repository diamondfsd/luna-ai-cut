import productShowcaseMarkdown from '../prompts/skills/product-showcase.md?raw'
import productUiLaunchMarkdown from '../prompts/skills/product-ui-launch.md?raw'
import creativeDecisionMarkdown from '../prompts/skills/foundations/creative-decision.md?raw'
import directingAndEditingMarkdown from '../prompts/skills/foundations/directing-and-editing.md?raw'
import reviewAndRefinementMarkdown from '../prompts/skills/foundations/review-and-refinement.md?raw'
import type { AiEditingSkill } from './types'

function readFrontmatter(markdown: string): {
  name: string
  description: string
  instructions: string
} {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  const frontmatter = match?.[1] ?? ''
  const valueFor = (key: string) =>
    frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
  return {
    name: valueFor('name'),
    description: valueFor('description'),
    instructions: match?.[2]?.trim() ?? markdown.trim(),
  }
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
      'workspace.list',
      'workspace.read',
      'workspace.search',
      'workspace.patch',
      'timeline.check',
      'timeline.build',
      'timeline.test',
      'timeline.diff',
      'git.commit',
      'timeline.publish_stage',
      'timeline.commit',
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
      'workspace.list',
      'workspace.read',
      'workspace.search',
      'workspace.patch',
      'timeline.check',
      'timeline.build',
      'timeline.test',
      'timeline.diff',
      'git.commit',
      'timeline.publish_stage',
      'timeline.commit',
    ],
    requiresFinishedVideo: true,
    source: 'built-in',
    enabled: true,
  }
}

function foundationSkill(
  id: string,
  name: string,
  description: string,
  instructions: string,
  triggers: string[],
): AiEditingSkill {
  return {
    id,
    name,
    description,
    instructions: instructions.trim(),
    triggers,
    toolIds: [],
    requiresFinishedVideo: false,
    source: 'built-in',
    enabled: true,
  }
}

export const BUILT_IN_AI_EDITING_SKILLS: readonly AiEditingSkill[] = Object.freeze([
  foundationSkill(
    'creative-decision',
    '创意决策',
    '用于确定叙事重点、受众、内容取舍和创意方向。',
    creativeDecisionMarkdown,
    ['创意', '脚本', '叙事', '受众', '内容取舍', '方向'],
  ),
  foundationSkill(
    'directing-and-editing',
    '导演与剪辑',
    '用于镜头组织、节奏、声音、文字和视觉重点的专业判断。',
    directingAndEditingMarkdown,
    ['剪辑', '镜头', '节奏', '声音', '字幕', '运镜'],
  ),
  foundationSkill(
    'review-and-refinement',
    '成片复核与优化',
    '用于检查成片是否满足目标并定位需要修正的问题。',
    reviewAndRefinementMarkdown,
    ['复核', '优化', '检查', '评审', '成片质量'],
  ),
  builtInProductUiLaunch(),
  builtInProductShowcase(),
])
