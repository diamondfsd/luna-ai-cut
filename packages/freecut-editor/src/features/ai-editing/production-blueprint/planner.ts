import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { AiProjectEvidence } from '../types'
import { parseProductUiLaunchBlueprint } from './validation'
import type { ProductUiLaunchBlueprint } from './types'

const MAX_BLUEPRINT_TOKENS = 1_600

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
蓝图结构：{"version":1,"title":"","audience":"","promise":"","tone":"","aspectRatio":"","replaceExisting":false,"videoTrack":1,"shots":[{"id":"SHOT-01","mediaId":"真实素材ID","region":"overview|top-left|toolbar|timeline|center","durationSeconds":2.5,"purpose":"叙事作用","evidence":"这张真实素材中可见的界面证据","camera":"push-in|pan-right|pan-left|pull-out|hold","caption":"可选画面文字"}]}。
必须输出 4 到 6 个连续镜头；镜头编号从 SHOT-01 递增；至少一个 overview 和一个 timeline；至少 3 个 caption，分别承担开场、展示、收尾；总时长保持在 12 到 30 秒。只使用 visual 非空的 image 或 video 素材。
你自行决定 replaceExisting：独立的新成片可替换无关旧内容；用户要求追加、续作或局部修改时保留现有内容。不要向用户索取确认。videoTrack 是项目证据中可用的 V 轨编号；新成片默认选 V1，只有需要叠层或保留既有画面时才选择更高编号。`,
    },
    ...params.history.slice(-4),
    { role: 'user', content: `用户请求：${params.request}\n\n项目证据：${JSON.stringify(params.evidence)}` },
  ], {
    maxTokens: MAX_BLUEPRINT_TOKENS,
    temperature: 0,
    signal: params.signal,
  })
  return parseProductUiLaunchBlueprint(raw, params.evidence)
}
