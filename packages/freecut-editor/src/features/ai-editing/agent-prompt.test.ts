import { describe, expect, it } from 'vitest'

import { buildAiEditingSystemPrompt } from './agent-prompt'

describe('AI editing system prompt', () => {
  it('includes directly usable common editing formats and reserves docs for extensions', async () => {
    const prompt = await buildAiEditingSystemPrompt('native', new Set([
      'docs.search',
      'docs.read',
      'source.read',
      'source.apply_changes',
      'timeline.compose_source',
    ]))

    expect(prompt).toContain('## 常用剪辑格式经验')
    expect(prompt).toContain('"kind": "clip-segment"')
    expect(prompt).toContain('"type": "video"')
    expect(prompt).toContain('"type": "audio"')
    expect(prompt).toContain('"type": "text"')
    expect(prompt).toContain('空时间轴的常规首剪直接调用 `timeline.compose_source`')
    expect(prompt).toContain('不要读取默认轨道，也不要手写三个 segment')
    expect(prompt).toContain('只有使用未列出的片段类型、效果、转场、关键帧或扩展属性时')
    expect(prompt).toContain('每批最多 4 个文件')
    expect(prompt).toContain('每次模型响应只发一个写入工具调用')
    expect(prompt).toContain('## 可用技能')
    expect(prompt).toContain('- product-showcase: Create a concise product-update or interface showcase video.')
    expect(prompt).toContain('- 创意决策: 用于确定叙事重点、受众、内容取舍和创意方向。')
    expect(prompt).toContain('使用 `skill.read` 按名称读取完整说明')
    expect(prompt).not.toContain('# Product Showcase')
    expect(prompt).not.toContain('skill.search')
  })
})
