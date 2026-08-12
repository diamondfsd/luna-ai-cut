import { describe, expect, it } from 'vitest'

import { buildAiEditingSystemPrompt } from './agent-prompt'

describe('AI editing system prompt', () => {
  it('includes directly usable common editing formats and reserves docs for extensions', async () => {
    const prompt = await buildAiEditingSystemPrompt('native', new Set([
      'docs.search',
      'docs.read',
      'source.read',
      'source.apply_changes',
    ]))

    expect(prompt).toContain('## 常用剪辑格式经验')
    expect(prompt).toContain('"kind": "clip-segment"')
    expect(prompt).toContain('"type": "video"')
    expect(prompt).toContain('"type": "audio"')
    expect(prompt).toContain('"type": "text"')
    expect(prompt).toContain('常用视频、音频和文字剪辑直接使用下方格式经验')
    expect(prompt).toContain('只有使用未列出的片段类型、效果、转场、关键帧或扩展属性时')
    expect(prompt).toContain('每批最多 4 个文件')
    expect(prompt).toContain('每次响应只调用一次写入工具')
  })
})
