import { AGENT_TASK_TOOLS } from './lunaMcpTaskCatalog.ts'
import { createAiEditorUserStoppedResult, type AiEditorAgentPhase, type AiEditorMcpResponse, type AiEditorMcpRequest } from '../../src/shared/types/aiEditor.ts'
import { AgentSessionError, type AgentToolResult } from './agentSessionManager.ts'
import { addAgentContext, type LunaMcpServerOptions } from './lunaMcpProtocol.ts'

const AGENT_TOOL_NAMES = new Set<string>(AGENT_TASK_TOOLS.map((tool) => tool.name))
const MUSIC_TOOL_NAMES = new Set(['list_music_templates', 'get_music_template', 'generate_background_music'])

function stringArg(args: Record<string, unknown>, name: string): string | null {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function integerArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = numberArg(args, name)
  return value !== undefined && Number.isInteger(value) ? value : undefined
}

const AGENT_PROGRESS_PHASES = new Set<AiEditorAgentPhase>([
  'waiting',
  'analyzing_media',
  'creating_project',
  'importing_media',
  'editing',
  'captioning',
  'saving',
  'exporting',
])

function isAgentProgressPhase(value: string | null): value is AiEditorAgentPhase {
  return value !== null && AGENT_PROGRESS_PHASES.has(value as AiEditorAgentPhase)
}

export function requestExplicitlyAsksForExport(request: string): boolean {
  const normalized = request.trim().toLowerCase()
  if (!normalized) return false

  const declined = [
    /(?:先|暂时|现在)?不要导出/,
    /(?:先|暂时|现在)?别导出/,
    /(?:先|暂时|现在)?无需导出/,
    /(?:剪辑完后|完成后|稍后|之后)?再(?:考虑|决定)?[\s\S]{0,4}导出/,
    /\b(?:do not|don't|dont|without)\s+(?:export|render|save)\b/,
  ].some((pattern) => pattern.test(normalized))
  if (declined) return false

  return /(导出|导出视频|导出音频|输出成片|导出成片|生成成片|保存成片|渲染成片)/.test(normalized)
    || /\b(?:export|render|save)(?:\s+(?:the|this|a))?\s+(?:video|audio|movie|file)\b/.test(normalized)
}

export function agentToolResponse(result: AgentToolResult | Record<string, unknown>): AiEditorMcpResponse {
  return { ok: true, result }
}

export function userStoppedResponse(): AiEditorMcpResponse {
  return agentToolResponse(createAiEditorUserStoppedResult())
}

export function requestRendererWithCancellation(
  options: LunaMcpServerOptions,
  request: AiEditorMcpRequest,
): Promise<AiEditorMcpResponse> {
  const manager = options.agentSession
  if (!manager) return options.requestRenderer(request)

  return new Promise<AiEditorMcpResponse>((resolve, reject) => {
    let settled = false
    const unsubscribe = manager.subscribe((event) => {
      if (event.type !== 'cancelled' || !event.session.cancelRequested || settled) return
      settled = true
      unsubscribe()
      resolve(userStoppedResponse())
    })
    void options.requestRenderer(request).then(
      (response) => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve(response)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        unsubscribe()
        reject(error)
      },
    )
  })
}

function agentInvalidParams(message: string): AiEditorMcpResponse {
  return agentToolResponse({
    ok: false,
    summary: message,
    error: { code: 'INVALID_PARAMS', message },
  })
}

async function handleMusicTool(
  name: string,
  args: Record<string, unknown>,
  options: LunaMcpServerOptions,
  callId: string,
): Promise<AiEditorMcpResponse | null> {
  if (!MUSIC_TOOL_NAMES.has(name)) return null

  if (name === 'generate_background_music') {
    const gate = options.agentSession?.gateActiveTool()
    if (!gate || !gate.allowed) {
      const message = gate?.error?.message ?? '请先领取或创建剪辑任务'
      return agentToolResponse({
        ok: false,
        summary: message,
        data: gate ? { session: gate.session } : undefined,
        error: gate?.error ?? { code: 'SESSION_REQUIRED', message },
      })
    }
  }

  const startedAt = Date.now()
  options.agentSession?.toolStarted(callId, name, args)
  const invalid = (message: string): AiEditorMcpResponse => {
    options.agentSession?.toolFinished(
      callId,
      name,
      args,
      false,
      message,
      Date.now() - startedAt,
      { code: 'INVALID_PARAMS', message },
    )
    return agentInvalidParams(message)
  }
  try {
    const music = options.musicTools
    if (!music) {
      const message = 'Luna 内置音乐引擎不可用，请重启应用后重试'
      const error = {
        code: 'MUSIC_RUNTIME_UNAVAILABLE',
        message,
        retryable: false,
        suggestedAction: '停止音乐生成并上报失败；这是 Luna 本地音乐运行时未注册，不是 DSL 参数问题。',
      }
      options.agentSession?.toolFinished(callId, name, args, false, message, Date.now() - startedAt, error)
      return agentToolResponse({ ok: false, summary: message, error })
    }
    if (name === 'list_music_templates') {
      const limit = args.limit === undefined ? undefined : integerArg(args, 'limit')
      if (args.limit !== undefined && limit === undefined) return invalid('limit 必须是正整数')
      const templates = await music.listMusicTemplates({
        tag: stringArg(args, 'tag') ?? undefined,
        scene: stringArg(args, 'scene') ?? undefined,
        dialogueSafe: typeof args.dialogueSafe === 'boolean' ? args.dialogueSafe : undefined,
        limit,
      })
      const result = addAgentContext({
        ok: true,
        summary: `找到 ${templates.length} 个背景音乐模板`,
        data: { templates },
      }, options.agentSession)
      options.agentSession?.toolFinished(callId, name, args, true, `找到 ${templates.length} 个背景音乐模板`, Date.now() - startedAt)
      return agentToolResponse(result as Record<string, unknown>)
    }

    if (name === 'get_music_template') {
      const templateId = stringArg(args, 'templateId')
      if (!templateId) return invalid('缺少 templateId')
      const template = await music.getMusicTemplate(templateId)
      const result = addAgentContext({
        ok: true,
        summary: `已读取音乐模板 ${templateId}`,
        data: { template },
      }, options.agentSession)
      options.agentSession?.toolFinished(callId, name, args, true, `已读取音乐模板 ${templateId}`, Date.now() - startedAt)
      return agentToolResponse(result as Record<string, unknown>)
    }

    const dsl = typeof args.dsl === 'string' && args.dsl.trim() ? args.dsl : null
    if (!dsl) return invalid('缺少 dsl')
    const generated = await music.generateBackgroundMusic(dsl, stringArg(args, 'name') ?? undefined)
    const summary = `已生成背景音乐 ${generated.name}（${generated.durationSec.toFixed(2)} 秒）`
    const result = addAgentContext({
      ok: true,
      summary,
      data: generated,
    }, options.agentSession)
    options.agentSession?.toolFinished(callId, name, args, true, summary, Date.now() - startedAt)
    return agentToolResponse(result as Record<string, unknown>)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const templateNotFound = name === 'get_music_template'
      && /unknown music template|音乐模板内容无效/i.test(message)
    const invalidDsl = name === 'generate_background_music'
      && /^line \d+:/m.test(message)
    const runtimeUnavailable = /SoundFont was not found|luna-bgm-worker|ENOENT|Cannot find module/i.test(message)
    const toolError = templateNotFound
      ? {
          code: 'MUSIC_TEMPLATE_NOT_FOUND',
          message,
          retryable: false,
          suggestedAction: '重新调用 list_music_templates，并使用返回的 templateId。',
        }
      : invalidDsl
        ? {
            code: 'MUSIC_DSL_INVALID',
            message,
            retryable: false,
            suggestedAction: '按错误行号修正 Music DSL，再调用一次；不要重复原参数。',
          }
        : runtimeUnavailable
          ? {
              code: 'MUSIC_RUNTIME_UNAVAILABLE',
              message,
              retryable: false,
              suggestedAction: '停止音乐生成并上报失败；这是 Luna 本地音乐运行时缺失，不是 DSL 参数问题。',
            }
          : {
              code: 'MUSIC_RENDER_FAILED',
              message,
              retryable: false,
              suggestedAction: '检查 Music DSL 的时值和轨道定义；修正后再调用一次，不要重复原参数。',
            }
    const failure = {
      ok: false,
      summary: message,
      error: toolError,
    }
    options.agentSession?.toolFinished(callId, name, args, false, message, Date.now() - startedAt, toolError)
    return agentToolResponse(failure)
  }
}

export async function handleAgentTaskTool(
  name: string,
  args: Record<string, unknown>,
  options: LunaMcpServerOptions,
  callId: string,
): Promise<AiEditorMcpResponse | null> {
  if (!AGENT_TOOL_NAMES.has(name)) return null
  const manager = options.agentSession
  if (manager) {
    const currentSession = manager.snapshot().session
    if (
      currentSession?.status === 'cancelled'
      && currentSession.cancelRequested
      && name !== 'start_edit_session'
      && name !== 'wait_for_edit_request'
      && name !== 'activate_luna_window'
    ) {
      return userStoppedResponse()
    }
  }

  const musicResult = await handleMusicTool(name, args, options, callId)
  if (musicResult) return musicResult
  if (!manager) return agentToolResponse({
    ok: false,
    summary: '外部 Agent 任务服务不可用',
    error: { code: 'UNSUPPORTED', message: '外部 Agent 任务服务不可用' },
  })

  try {
    if (name === 'start_edit_session') {
      const request = stringArg(args, 'request')
      const agentId = stringArg(args, 'agentId')
      const agentType = stringArg(args, 'agentType')
      const agentModel = stringArg(args, 'agentModel')
      if (!request || !agentId || !agentType || !agentModel) {
        return agentInvalidParams('请同时上报 request、agentId、agentType 和 agentModel')
      }
      if (args.purpose !== undefined && !['editing', 'director-plan'].includes(String(args.purpose))) return agentInvalidParams('任务类型无效')
      const result = manager.startExternalRequest(
        request,
        agentId,
        stringArg(args, 'projectId'),
        agentType,
        agentModel,
        args.purpose as 'editing' | 'director-plan' | undefined,
      )
      if (result.session?.purpose !== 'director-plan') await options.activateWindow?.()
      return agentToolResponse({
        ok: true,
        summary: '已创建并领取外部剪辑任务',
        data: result,
      })
    }

    if (name === 'wait_for_edit_request') {
      const agentId = stringArg(args, 'agentId')
      const agentType = stringArg(args, 'agentType')
      const agentModel = stringArg(args, 'agentModel')
      if (!agentId || !agentType || !agentModel) {
        return agentInvalidParams('请同时上报 agentId、agentType 和 agentModel')
      }
      const result = await manager.waitForRequest(
        agentId,
        numberArg(args, 'timeoutSec'),
        agentType,
        agentModel,
      )
      if (result.state === 'claimed' && result.session?.purpose !== 'director-plan') await options.activateWindow?.()
      return agentToolResponse({
        ok: true,
        summary: result.state === 'claimed' ? '已领取 Luna 剪辑任务' : '当前没有新的剪辑任务',
        data: result.state === 'idle'
          ? { ...result, nextAction: '如任务来自外部对话，请调用 start_edit_session 并传入用户原始要求' }
          : result,
      })
    }

    if (name === 'get_edit_request') {
      const sessionId = stringArg(args, 'sessionId')
      if (!sessionId) return agentInvalidParams('缺少 sessionId')
      const knownRevision = args.knownRevision === undefined ? undefined : integerArg(args, 'knownRevision')
      if (args.knownRevision !== undefined && knownRevision === undefined) return agentInvalidParams('knownRevision 必须是正整数')
      const result = manager.getRequest(sessionId, knownRevision)
      return agentToolResponse({
        ok: true,
        summary: result.changed ? '用户剪辑要求已更新' : '剪辑要求没有变化',
        data: result,
      })
    }

    if (name === 'report_edit_progress') {
      const sessionId = stringArg(args, 'sessionId')
      const revision = integerArg(args, 'revision')
      const phase = stringArg(args, 'phase')
      const progress = numberArg(args, 'progress')
      const message = stringArg(args, 'message')
      if (!sessionId || revision === undefined || !isAgentProgressPhase(phase) || progress === undefined || progress < 0 || progress > 100 || !message) {
        return agentInvalidParams('缺少进度上报参数')
      }
      return agentToolResponse(manager.reportProgress(sessionId, revision, phase, progress, message))
    }

    if (name === 'report_edit_result') {
      const sessionId = stringArg(args, 'sessionId')
      const revision = integerArg(args, 'revision')
      const status = stringArg(args, 'status')
      if (!sessionId || revision === undefined || (status !== 'completed' && status !== 'failed' && status !== 'cancelled')) {
        return agentInvalidParams('缺少结果上报参数')
      }
      return agentToolResponse(manager.reportResult(
        sessionId,
        revision,
        status,
        stringArg(args, 'summary') ?? undefined,
        stringArg(args, 'projectId') ?? undefined,
        stringArg(args, 'projectName') ?? undefined,
      ))
    }

    if (name === 'activate_luna_window') {
      if (manager.snapshot().session?.purpose === 'director-plan') return agentToolResponse({ ok: true, summary: '导演计划进度已发送到 AI 助手' })
      await options.activateWindow?.()
      return agentToolResponse({ ok: true, summary: '已通知 Luna AI Cut 显示剪辑进度' })
    }

    const sessionId = stringArg(args, 'sessionId')
    if (!sessionId) return agentInvalidParams('缺少 sessionId')
    return agentToolResponse({ ok: true, summary: '已请求停止剪辑任务', data: manager.cancelRequest(sessionId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof AgentSessionError ? error.code : 'AGENT_SESSION_ERROR'
    return agentToolResponse({ ok: false, summary: message, error: { code, message } })
  }
}
