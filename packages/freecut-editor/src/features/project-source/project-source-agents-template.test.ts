import { describe, expect, it } from 'vitest'

import {
  isLegacyProjectSourceAgentsTemplate,
  PROJECT_SOURCE_AGENTS_TEMPLATE,
} from './project-source-agents-template'

describe('project source AGENTS template', () => {
  it('documents structured editing tools and their unit boundaries', () => {
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('timeline.add_media')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('timeline.add_text')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('timeline.list_transitions')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('project.set_canvas')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('memory.read')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('memory.search')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('memory.update')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('memory.remove')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('0 到 1 归一化')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('不要直接编辑工程源码 JSON')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('当前用户明确要求 > 当前项目临时要求')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).toContain('不能在工程源码目录创建 `user-preferences.md`')
    expect(PROJECT_SOURCE_AGENTS_TEMPLATE).not.toContain('所有时间轴编辑都应落在本目录允许的 JSON 源码文件中')
  })

  it('only marks the generated legacy template for automatic refresh', () => {
    expect(isLegacyProjectSourceAgentsTemplate(PROJECT_SOURCE_AGENTS_TEMPLATE)).toBe(false)
    expect(isLegacyProjectSourceAgentsTemplate(`${PROJECT_SOURCE_AGENTS_TEMPLATE}\n自定义说明`)).toBe(false)
  })
})
