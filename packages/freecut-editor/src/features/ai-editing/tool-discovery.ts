import type { AiEditingTool } from './types'

export interface AiEditingToolCatalogEntry {
  id: string
  title: string
}

export interface AiEditingToolDetails {
  id: string
  title: string
  description: string
}

const SEARCH_KEYWORDS: Record<string, string[]> = {
  'analysis.search_transcript': ['口播', '台词', '文案', '说话', '搜索字幕'],
  'captions.generate': ['字幕', '字幕条'],
  'timeline.compose_from_media': ['混剪', '成片', '编排', '素材', 'vlog', '日常'],
  'audio.inspect_beats': ['节拍', '卡点', 'bpm', '音乐'],
  'audio.analyze_beats': ['节拍分析', '卡点', 'bpm', '音乐'],
  'timeline.split_on_beats': ['卡点', '节拍切分', '踩点'],
  'timeline.remove_silence': ['静音', '停顿', '空白'],
  'timeline.remove_fillers': ['语气词', '嗯', '啊', '额'],
  'settings.inspect': ['设置', '比例', '分辨率', '帧率', '画布'],
  'settings.update': ['设置', '比例', '分辨率', '帧率', '画布'],
  'timeline.find_clips': ['片段', '查找视频', '查找音频'],
  'timeline.search_transcript': ['搜索口播', '台词', '提到'],
  'timeline.select_clips': ['选择片段', '选中'],
  'timeline.seek_to': ['定位', '播放头', '时间点'],
  'timeline.add_title': ['标题', '文字', '文本'],
  'timeline.split': ['切分', '分割', '切开'],
  'timeline.delete_clips': ['删除', '删掉', '移除'],
  'timeline.set_speed': ['速度', '加速', '减速', '慢放', '快放'],
  'timeline.set_volume': ['音量', '声音', '静音'],
  'timeline.trim_clip': ['裁剪', '修剪', '去头', '去尾'],
  'timeline.add_transition': ['转场', '过渡'],
}

export function listAiEditingToolCatalog(tools: readonly AiEditingTool[]): AiEditingToolCatalogEntry[] {
  return tools.map((tool) => ({ id: tool.id, title: tool.title }))
}

export function describeAiEditingTools(
  toolIds: string[],
  tools: readonly AiEditingTool[],
): AiEditingToolDetails[] {
  const requested = new Set(toolIds)
  return tools
    .filter((tool) => requested.has(tool.id) && tool.id !== 'tool.describe')
    .map((tool) => ({ id: tool.id, title: tool.title, description: tool.description }))
}

export function searchAiEditingTools(query: string, tools: readonly AiEditingTool[], limit = 8): AiEditingToolDetails[] {
  const normalizedQuery = query.trim().toLowerCase()
  return tools
    .filter((tool) => tool.id !== 'tool.describe' && tool.id !== 'tool.search')
    .map((tool, index) => {
      const searchable = [tool.id, tool.title, tool.description, ...(SEARCH_KEYWORDS[tool.id] ?? [])]
        .map((value) => value.toLowerCase())
      const score = searchable.reduce((total, value) => {
        if (value === normalizedQuery) return total + 12
        if (value.includes(normalizedQuery) || normalizedQuery.includes(value)) return total + 6
        return total
      }, 0)
      return { tool, index, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ tool }) => ({ id: tool.id, title: tool.title, description: tool.description }))
}
