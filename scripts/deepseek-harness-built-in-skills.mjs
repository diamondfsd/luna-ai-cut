import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const BUILT_IN_SKILL_SPECS = [
  'master/SKILL.md',
  'styles/cinematic-documentary/SKILL.md',
  'styles/emotional-montage/SKILL.md',
  'styles/family-documentary/SKILL.md',
  'styles/fast-beat/SKILL.md',
  'styles/talking-head/SKILL.md',
  'styles/luna-style-talking-head-short/SKILL.md',
  'styles/travel-vlog/SKILL.md',
  'techniques/luna-technique-story-structure/SKILL.md',
  'techniques/luna-technique-cutting-rhythm/SKILL.md',
  'techniques/luna-technique-audio-design/SKILL.md',
  'techniques/luna-technique-color-look/SKILL.md',
  'techniques/luna-technique-motion-graphics/SKILL.md',
  'techniques/luna-technique-retiming-transitions/SKILL.md',
  'techniques/luna-technique-editing-playbook/SKILL.md',
  'styles/luna-style-social-short/SKILL.md',
  'styles/luna-style-commercial-product/SKILL.md',
  'styles/luna-style-music-video/SKILL.md',
  'styles/luna-style-news-knowledge/SKILL.md',
  'styles/luna-style-ambient-cinematic/SKILL.md',
  'styles/luna-style-sports-action/SKILL.md',
  'workflows/luna-workflow-capcut/SKILL.md',
  'workflows/luna-workflow-premiere/SKILL.md',
  'workflows/luna-workflow-after-effects/SKILL.md',
  'workflows/luna-workflow-short-form-production/SKILL.md',
]

const SHARED_FILES = [
  'shared/creative-brief.md',
  'shared/editing-contract.md',
  'shared/research-sources.md',
]

export const BUILT_IN_SKILL_NAMES = Object.freeze([
  'luna-editing-master',
  'luna-style-cinematic-documentary',
  'luna-style-emotional-montage',
  'luna-style-family-documentary',
  'luna-style-fast-beat',
  'luna-style-talking-head',
  'luna-style-talking-head-short',
  'luna-style-travel-vlog',
  'luna-technique-story-structure',
  'luna-technique-cutting-rhythm',
  'luna-technique-audio-design',
  'luna-technique-color-look',
  'luna-technique-motion-graphics',
  'luna-technique-retiming-transitions',
  'luna-technique-editing-playbook',
  'luna-style-social-short',
  'luna-style-commercial-product',
  'luna-style-music-video',
  'luna-style-news-knowledge',
  'luna-style-ambient-cinematic',
  'luna-style-sports-action',
  'luna-workflow-capcut',
  'luna-workflow-premiere',
  'luna-workflow-after-effects',
  'luna-workflow-short-form-production',
])

const SCRIPT_ONLY_GUIDANCE = [
  '## 脚本执行方式',
  '',
  '模型唯一的编辑入口是 `edit.run_script`。所有项目读取、素材证据、记忆读写、异步生成、时间轴修改和结果复核，都必须写在同一段 ESM 剪辑脚本中，通过 `luna.*` 方法完成。不要直接调用宿主内部实现或修改项目文件。',
  '',
  '脚本必须导出 `default async function main(luna)`。脚本可以使用完整 JavaScript 语法，在本地完成循环、条件判断、数组筛选和批量操作。SDK 方法返回结构化结果，实际能力数据必须从 `result.data` 读取；每个脚本阶段读取结构化结果，并返回简短结果供模型继续判断。',
  '',
  '时间线方法的时间参数统一使用秒数：`trim` 使用 `startSeconds/endSeconds`，`split` 使用 `atSeconds`，`move` 使用 `toSeconds`。先用 `timeline.addTrack({ type: "video" | "audio", name?, order? })` 规划独立轨道：字幕/标题使用独立视频轨道，TTS/音乐/音效使用独立音频轨道。转场的 `type` 只能是 `"crossfade"`，使用 `fromClipId/toClipId/type:"crossfade"/durationSeconds`；需要淡化视觉样式时另传 `presentation:"fade"`，不要把 `fade` 作为 `type`，也不要省略 `type`。两个画面片段必须在同一视频轨道的切点相邻，且相邻转场两侧都要有未使用的源素材余量。',
  '',
  '长期偏好使用 `memory.read/search/update/remove`：先读取或搜索已有记录，只有跨项目可复用的用户偏好才保存；更新已有偏好时复用准确的 memoryId，删除时只使用读取结果中的 ID。一次性任务要求和模型推断不写入记忆。',
  '',
  '素材分析使用 `media.analyze({ mediaIds, kind })` 提交任务，再循环调用 `media.get_analysis_task({ taskId })`。TTS 使用 `audio.startSpeech`；背景音乐或音效使用 `audio.startMusic`，其中 `model` 为 `small-music` 或 `small-sfx`；这些调用都先返回 taskId。只有任务状态为 `completed` 时才使用 mediaId 或 `media.read` 的结果，`failed` 时读取结构化错误且不能假设分析结果存在。`queued`、`preparing-model`、`generating` 和 `saving` 都必须继续等待，不能提前报告完成。',
].join('\n')

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

async function readShared(root, relativePath) {
  return await readFile(path.join(root, relativePath), 'utf8').then(content => content.trim())
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

  const parsed = await Promise.all(BUILT_IN_SKILL_SPECS.map(async relativePath => {
    return await readSkill(root, relativePath)
  }))
  const shared = await Promise.all(SHARED_FILES.map(relativePath => readShared(root, relativePath)))
  const master = parsed.find(skill => skill.name === 'luna-editing-master')
  if (master === undefined) throw new Error('Luna AI Cut 内置剪辑大师技能缺失。')

  const sharedInstructions = [
    '## Harness 已加载的通用剪辑契约',
    '',
    '以下共享资料是本技能的通用执行依据。它们已经随本次技能加载，不需要通过项目路径再次寻找。',
    '',
    ...shared.flatMap((content, index) => [
      content,
      ...(index === 0 ? ['', '---', ''] : []),
    ]),
  ].join('\n')

  return parsed.map(skill => withRuntimeMetadata({
    ...skill,
    content: `${SCRIPT_ONLY_GUIDANCE}\n\n${skill.content}${skill.name === master.name ? `\n\n${sharedInstructions}` : ''}`,
  }))
}

export async function registerBuiltInSkills(ctx) {
  const skills = await loadBuiltInSkills()
  for (const skill of skills) ctx.skills.register(skill)
  return skills.map(skill => skill.name)
}
