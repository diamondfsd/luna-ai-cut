import type { DirectorLanPlanSummary } from '../shared/types'

export function buildDirectorAiPrompt(plan: DirectorLanPlanSummary): string {
  const directory = plan.local_directory
  if (!directory) throw new Error('请先下载到文件夹')
  const basePath = directory.replace(/[\\/]+$/, '')
  return [
    `素材：${plan.title}`,
    `计划 ID：${plan.id}`,
    `素材目录：${directory}`,
    `素材清单：${basePath}/manifest.json`,
    `镜头说明：${basePath}/README.md`,
    '',
    '文件规则：',
    '- 清单中的 shots 是镜头分组，shots[].media 是各组素材。',
    '- media.path 相对素材目录；path 为空或 available 为 false 表示素材未下载。',
    '- 计划主要内容、镜头描述和方案是用户已规划的核心剪辑需求；按导拍结构组织成片，在各镜头全部素材中挑选可用段落，不另行重构无关故事。',
    '- 镜头列表顺序不约束成片顺序；可按叙事、节奏和衔接自由重排，只有用户明确要求时才固定顺序。',
    '- 素材检查用于处理拍摄偏差、选取可用段落和衔接；位置、时间、来源与亮点辅助判断。selected_range 是允许选取范围。',
    '- selected_range.start_ms/end_ms 和 markers 的时间均对应原素材时间轴，单位为毫秒。',
    '- 在 Luna AI Cut 中剪辑时，先发现并读取导演剪辑技能，通过本地素材列表的 directorContexts 匹配该计划，再校验并应用剪辑方案。',
    '- 原素材保持不变。',
  ].join('\n')
}
