import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { AiProjectEvidence } from '../types'
import { parseProductUiLaunchBlueprint } from './validation'
import type { ProductUiLaunchBlueprint } from './types'

const MAX_BLUEPRINT_TOKENS = 1_600

function hasReplacementApproval(request: string): boolean {
  return /(确认|同意).{0,12}(清理|替换)|清理.{0,12}(旧|当前).{0,12}(内容|时间轴|素材)/.test(request)
}

export async function planProductUiLaunch(params: {
  request: string
  history: LlmMessage[]
  evidence: AiProjectEvidence
  adapter: LlmAdapter
  signal?: AbortSignal
}): Promise<ProductUiLaunchBlueprint> {
  const raw = await params.adapter.generate([
    {
      role: 'system',
      content: `你是产品界面短片的制片。根据真实项目证据，输出一份可执行的制作蓝图。
只返回一个 JSON 对象，不要 Markdown，不要解释。不得虚构素材、界面功能、素材路径或音频。
蓝图结构：{"version":1,"title":"","audience":"","promise":"","tone":"","aspectRatio":"","replaceExisting":false,"shots":[{"id":"SHOT-01","mediaId":"真实素材ID","region":"overview|top-left|toolbar|timeline|center","durationSeconds":2.5,"purpose":"叙事作用","evidence":"这张真实素材中可见的界面证据","camera":"push-in|pan-right|pan-left|pull-out|hold","caption":"可选画面文字"}]}。
必须输出 4 到 6 个连续镜头；镜头编号从 SHOT-01 递增；至少一个 overview 和一个 timeline；至少 3 个 caption，分别承担开场、展示、收尾；总时长保持在 12 到 30 秒。只使用 visual 非空的 image 或 video 素材。
replaceExisting 仅当用户在当前请求中明确同意清理旧内容时设为 true。`,
    },
    ...params.history.slice(-4),
    { role: 'user', content: `用户请求：${params.request}\n\n项目证据：${JSON.stringify(params.evidence)}` },
  ], {
    maxTokens: MAX_BLUEPRINT_TOKENS,
    temperature: 0,
    signal: params.signal,
  })
  const blueprint = parseProductUiLaunchBlueprint(raw, params.evidence)
  const approved = hasReplacementApproval(params.request)
  if (blueprint.replaceExisting && !approved) {
    throw new Error('制作计划试图清理现有内容，但用户尚未明确确认。')
  }
  return approved && !blueprint.replaceExisting ? { ...blueprint, replaceExisting: true } : blueprint
}
