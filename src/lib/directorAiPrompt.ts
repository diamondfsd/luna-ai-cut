import type { DirectorLanPlanSummary } from '../shared/types'

export function buildDirectorAiPrompt(plan: DirectorLanPlanSummary): string {
  const directory = plan.local_directory
  if (!directory) throw new Error('请先下载到文件夹')
  const basePath = directory.replace(/[\\/]+$/, '')
  return [
    `素材：${plan.title}`,
    `素材目录：${directory}`,
    `素材清单：${basePath}/manifest.json`,
    `镜头说明：${basePath}/README.md`,
    '',
    '文件规则：',
    '- 清单中的 shots 是镜头分组，shots[].media 是各组素材。',
    '- media.path 相对素材目录；path 为空或 available 为 false 表示素材未下载。',
    '- 镜头描述、备注、selected_range 和 markers 是素材参考信息，不是剪辑限制。',
    '- selected_range.start_ms/end_ms 和 markers 的时间均对应原素材时间轴，单位为毫秒。',
    '- 原素材保持不变。',
  ].join('\n')
}
