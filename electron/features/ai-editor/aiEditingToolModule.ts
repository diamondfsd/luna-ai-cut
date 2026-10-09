import { randomUUID } from 'node:crypto'

import type { EditProjectClip, FootageSelectionItem, LunaEditProject } from '../../../src/shared/types/aiEditing.ts'
import type { WatermarkPositioning } from '../../../src/shared/types/render.ts'
import { clipAverageSpeed, clipOutputDurationMs, orderedTimelineClips } from '../../../src/shared/aiEditingTimeline.ts'
import { addAiEditorProjectMedia, createAiEditorProject, listAiEditorProjects, loadAiEditorProject, saveAiEditorProject, setAiEditorProjectMusic, undoAiEditorProjectTask } from './aiEditorProjectService.ts'
import { listAiEditorFilters, listAiEditorWatermarks } from './aiEditorExportService.ts'
import { getAiEditorLocalMedia, listAiEditorLocalMedia } from './aiEditorLocalMediaService.ts'
import { inspectAiEditorLocalMedia } from './aiEditorMediaAnalysisService.ts'
import { listFootageSelectionProjects, loadFootageSelectionProject } from './footageSelectionService.ts'
import { AgentSessionError } from '../../mcp/agentSessionManager.ts'
import { addAgentContext, type LunaMcpServerOptions } from '../../mcp/lunaMcpProtocol.ts'
import type { LunaToolModule } from '../../mcp/lunaToolModule.ts'

const allEditingPurposes = ['footage-creation', 'editing-workspace'] as const
const taskFields = {
  sessionId: { type: 'string', minLength: 1 },
  revision: { type: 'integer', minimum: 1 },
}

function clipDuration(clip: EditProjectClip): number {
  return clipOutputDurationMs(clip)
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return { name, description, inputSchema: { type: 'object', additionalProperties: false, properties, required } }
}

const tools = [
  tool('footage_find_annotated', 'Find local photos and videos with user likes, comments, tags, liked moments or ranges. Defaults to annotated footage captured in the last 24 hours; use explicit all_time only when the user asks for all history.', {
    projectId: { type: 'string' }, hours: { type: 'number', minimum: 1, maximum: 8760 }, allTime: { type: 'boolean' },
    calendarDay: { type: 'string', enum: ['today', 'yesterday'] }, since: { type: 'string' }, until: { type: 'string' },
    includeUnknownCaptureTime: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
  }),
  tool('footage_read_project', 'Read one existing footage annotation project by its real projectId. Does not change user decisions.', { projectId: { type: 'string', minLength: 1 } }, ['projectId']),
  tool('footage_inspect_asset', 'Inspect real still frames from selected local media. Returned images are the only visual evidence; sparse frames do not prove continuous events or audio.', {
    mediaIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
    mode: { type: 'string', enum: ['overview', 'detail'] },
    frameTimes: { type: 'object', additionalProperties: { type: 'array', maxItems: 3, items: { type: 'number', minimum: 0 } } },
  }, ['mediaIds']),
  tool('editing_workspace_list', 'List native Luna edit projects. Source paths are omitted; use stable project and source IDs in later calls.', {}),
  tool('editing_workspace_create', 'Create a native Luna edit project from selected local media IDs. This creates an editable project, not a rendered video.', {
    ...taskFields, name: { type: 'string', minLength: 1, maxLength: 120 }, mediaIds: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', minLength: 1 } },
  }, ['sessionId', 'revision', 'name', 'mediaIds']),
  tool('editing_workspace_read', 'Read the current native edit project with stable source/clip IDs and revision. Source paths are omitted.', { projectId: { type: 'string', minLength: 1 } }, ['projectId']),
  tool('editing_workspace_filters', 'List real local LUT filter IDs available to the editing workspace.', {}),
  tool('editing_workspace_watermarks', 'List real imported watermark IDs available to the editing workspace.', {}),
  tool('editing_workspace_music_templates', 'List real Luna background music templates.', {
    tag: { type: 'string' }, scene: { type: 'string' }, dialogueSafe: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 },
  }),
  tool('editing_workspace_read_music_template', 'Read one real music template and its editable DSL.', { templateId: { type: 'string', minLength: 1 } }, ['templateId']),
  tool('editing_workspace_generate_music', 'Generate a background track from Music DSL and attach it to the current project in one revision.', {
    ...taskFields, projectId: { type: 'string', minLength: 1 }, projectRevision: { type: 'integer', minimum: 1 },
    dsl: { type: 'string', minLength: 1 }, name: { type: 'string', maxLength: 120 },
  }, ['sessionId', 'revision', 'projectId', 'projectRevision', 'dsl']),
  tool('editing_workspace_undo_task', 'Undo the most recent AI task in this project when no later manual or AI edit has been applied.', {
    ...taskFields, projectId: { type: 'string', minLength: 1 }, projectRevision: { type: 'integer', minimum: 1 }, taskId: { type: 'string', minLength: 1 },
  }, ['sessionId', 'revision', 'projectId', 'projectRevision', 'taskId']),
  tool('editing_workspace_edit', 'Apply a validated batch of edits as one revision. Re-read after each write; never guess IDs or revision.', {
    ...taskFields, projectId: { type: 'string', minLength: 1 }, projectRevision: { type: 'integer', minimum: 1 },
    operations: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } },
  }, ['sessionId', 'revision', 'projectId', 'projectRevision', 'operations']),
] as const

function sessionForWrite(options: LunaMcpServerOptions, args: Record<string, unknown>, allowedPurposes: readonly string[]) {
  const manager = options.agentSession
  if (!manager) throw new AgentSessionError('SESSION_REQUIRED', '任务服务不可用')
  const gate = manager.gateActiveTool()
  if (!gate) throw new AgentSessionError('SESSION_REQUIRED', '请先领取任务')
  if (!gate.allowed) throw new AgentSessionError(gate.error?.code ?? 'SESSION_NOT_ACTIVE', gate.error?.message ?? '任务不可用')
  if (!allowedPurposes.includes(gate.session.purpose ?? 'auto')) throw new AgentSessionError('TASK_TYPE_CONFLICT', '当前技能不能修改剪辑工程')
  if (args.sessionId !== gate.session.sessionId) throw new AgentSessionError('SESSION_NOT_FOUND', '任务编号无效')
  if (args.revision !== gate.session.revision) throw new AgentSessionError('REQUEST_UPDATED', '任务要求已更新，请重新读取')
  return { manager, session: gate.session }
}

function hasAnnotation(item: FootageSelectionItem): boolean {
  return item.decision !== 'undecided' || Boolean(item.comment.trim()) || item.tags.length > 0 || item.points.length > 0 || item.ranges.length > 0
}

function captureWindow(args: Record<string, unknown>): { start: number | null; end: number | null; includeUnknown: boolean } {
  const now = new Date()
  let start: number | null = null
  let end: number | null = null
  if (args.allTime === true) return { start, end, includeUnknown: args.includeUnknownCaptureTime === true }
  if (args.calendarDay === 'today' || args.calendarDay === 'yesterday') {
    const date = new Date(now)
    if (args.calendarDay === 'yesterday') date.setDate(date.getDate() - 1)
    date.setHours(0, 0, 0, 0)
    start = date.getTime()
    date.setDate(date.getDate() + 1)
    end = date.getTime()
  } else if (typeof args.since === 'string' || typeof args.until === 'string') {
    start = typeof args.since === 'string' ? Date.parse(args.since) : null
    end = typeof args.until === 'string' ? Date.parse(args.until) : null
    if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end)) || (start !== null && end !== null && end <= start)) {
      throw new Error('素材时间范围无效')
    }
  } else {
    const hours = typeof args.hours === 'number' && Number.isFinite(args.hours) ? Math.min(8760, Math.max(1, args.hours)) : 24
    start = now.getTime() - hours * 60 * 60 * 1000
    end = now.getTime()
  }
  return { start, end, includeUnknown: args.includeUnknownCaptureTime === true }
}

async function findAnnotated(args: Record<string, unknown>, baseDir: string) {
  const window = captureWindow(args)
  const [projects, media] = await Promise.all([
    listFootageSelectionProjects(baseDir),
    (async () => {
      const all: Awaited<ReturnType<typeof listAiEditorLocalMedia>> = []
      for (let offset = 0; ; offset += 500) {
        const page = await listAiEditorLocalMedia({ limit: 500, offset })
        all.push(...page)
        if (page.length < 500) return all
      }
    })(),
  ])
  const selectedProjects = typeof args.projectId === 'string' ? projects.filter(item => item.projectId === args.projectId) : projects
  const mediaById = new Map(media.map(item => [item.mediaId, item]))
  const results: Array<Record<string, unknown>> = []
  for (const summary of selectedProjects) {
    const project = await loadFootageSelectionProject(baseDir, summary.projectId)
    for (const item of Object.values(project.items)) {
      if (!hasAnnotation(item)) continue
      const asset = mediaById.get(item.mediaId)
      if (!asset || (asset.kind !== 'video' && asset.kind !== 'image')) continue
      const captureTime = Date.parse(asset.capturedAt ?? '')
      if (window.start !== null && Number.isFinite(captureTime) && captureTime < window.start) continue
      if (window.end !== null && Number.isFinite(captureTime) && captureTime >= window.end) continue
      if (!Number.isFinite(captureTime) && !window.includeUnknown) continue
      results.push({ projectId: project.id, projectName: project.name, assetId: item.mediaId, name: asset.name,
        kind: asset.kind, capturedAt: asset.capturedAt, captureTimeMissing: !Number.isFinite(captureTime), durationSec: asset.duration ?? null,
        decision: item.decision, comment: item.comment, tags: item.tags, points: item.points, ranges: item.ranges, markedAt: item.updatedAt })
    }
  }
  results.sort((a, b) => Date.parse(String(b.capturedAt ?? '')) - Date.parse(String(a.capturedAt ?? '')))
  const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 100
  return { items: results.slice(offset, offset + limit), total: results.length, offset, nextOffset: offset + limit < results.length ? offset + limit : null }
}

function redactProject(project: LunaEditProject): LunaEditProject {
  const { aiUndo: _history, ...visible } = project
  return { ...visible, sources: project.sources.map(source => ({ ...source, path: '' })) }
}

function applyOperations(project: LunaEditProject, rawOperations: unknown[], filterIds: Set<string>, watermarkIds: Set<string>): LunaEditProject {
  let clips = [...project.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs).map(clip => ({ ...clip }))
  const sources = new Map(project.sources.map(source => [source.id, source]))
  let music = project.music ? { ...project.music } : null
  let musicEnabled = project.musicEnabled !== false
  let filter = project.filter ? { ...project.filter } : null
  let watermark = project.watermark ? { ...project.watermark, positioning: { ...project.watermark.positioning } } : null
  for (const raw of rawOperations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('剪辑操作格式无效')
    const operation = raw as Record<string, unknown>
    const action = operation.action
    if (action === 'append') {
      const sourceId = typeof operation.source_id === 'string' ? operation.source_id : ''
      const source = sources.get(sourceId)
      if (!source || source.kind === 'audio') throw new Error(`素材来源不存在：${sourceId}`)
      const sourceStartMs = typeof operation.start_ms === 'number' ? Math.round(operation.start_ms) : 0
      const defaultDuration = source.durationMs ?? 5000
      const duration = typeof operation.duration_ms === 'number' ? Math.round(operation.duration_ms) : defaultDuration
      const sourceEndMs = sourceStartMs + duration
      if (sourceStartMs < 0 || duration <= 0 || (source.kind === 'image' && (duration < 1000 || duration > 30000))
        || (source.durationMs !== null && sourceEndMs > source.durationMs)) throw new Error('新增片段源区间无效')
      const clip: EditProjectClip = { id: randomUUID(), sourceId, sourceStartMs, sourceEndMs,
        timelineStartMs: 0, volume: 1, ...(source.kind === 'image' ? { photoMotion: 'gentleZoomIn' as const } : {}) }
      const targetIndex = typeof operation.target_index === 'number' ? Math.floor(operation.target_index) : clips.length
      if (targetIndex < 0 || targetIndex > clips.length) throw new Error('插入位置无效')
      clips.splice(targetIndex, 0, clip)
    } else if (action === 'move') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const sourceIndex = clips.findIndex(clip => clip.id === clipId)
      const targetIndex = typeof operation.target_index === 'number' ? Math.floor(operation.target_index) : -1
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= clips.length) throw new Error('片段或目标位置无效')
      const [clip] = clips.splice(sourceIndex, 1)
      clips.splice(targetIndex, 0, clip)
    } else if (action === 'replace' || action === 'slip' || action === 'trim') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const clip = clips.find(item => item.id === clipId)
      if (!clip) throw new Error(`时间线片段不存在：${clipId}`)
      const currentSource = sources.get(clip.sourceId)!
      let source = currentSource
      let start = clip.sourceStartMs
      let end = clip.sourceEndMs
      if (action === 'replace') {
        const sourceId = typeof operation.source_id === 'string' ? operation.source_id : ''
        source = sources.get(sourceId)!
        if (!source || source.kind === 'audio') throw new Error(`素材来源不存在：${sourceId}`)
        start = typeof operation.start_ms === 'number' ? Math.round(operation.start_ms) : 0
        const requestedDuration = typeof operation.duration_ms === 'number' ? Math.round(operation.duration_ms) : clipDuration(clip)
        end = start + requestedDuration
      } else if (action === 'trim') {
        start = typeof operation.start_ms === 'number' ? Math.round(operation.start_ms) : start
        const requestedDuration = typeof operation.duration_ms === 'number' ? Math.round(operation.duration_ms) : end - start
        end = start + requestedDuration
      } else {
        start = typeof operation.start_ms === 'number' ? Math.round(operation.start_ms) : start
        end = start + (clip.sourceEndMs - clip.sourceStartMs)
      }
      if (start < 0 || end <= start || (source.kind === 'image' && (end - start < 1000 || end - start > 30000))
        || (source.durationMs !== null && end > source.durationMs)) throw new Error('片段源区间无效')
      clip.sourceId = source.id
      clip.sourceStartMs = start
      clip.sourceEndMs = end
      if (source.kind === 'image') clip.volume = 0
    } else if (action === 'original_volume') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const volume = operation.volume
      const clip = clips.find(item => item.id === clipId)
      if (!clip || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('原声音量参数无效')
      clip.volume = volume
    } else if (action === 'color') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const clip = clips.find(item => item.id === clipId)
      if (!clip) throw new Error(`时间线片段不存在：${clipId}`)
      const values: Record<string, number> = {}
      for (const key of ['exposure', 'shadows', 'highlights', 'saturation'] as const) {
        const value = operation[key]
        if (value === undefined) continue
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`调色参数无效：${key}`)
        if ((key === 'exposure' && (value < -5 || value > 5)) || (key !== 'exposure' && (value < -100 || value > 100))) throw new Error(`调色参数超出范围：${key}`)
        values[key] = value
      }
      clip.color = { ...clip.color, ...values }
    } else if (action === 'photo_motion') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const clip = clips.find(item => item.id === clipId)
      const source = clip ? sources.get(clip.sourceId) : null
      if (!clip || source?.kind !== 'image' || (operation.photo_motion !== 'none' && operation.photo_motion !== 'gentleZoomIn')) {
        throw new Error('照片运镜参数无效')
      }
      clip.photoMotion = operation.photo_motion
    } else if (action === 'speed_curve') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const clip = clips.find(item => item.id === clipId)
      const source = clip ? sources.get(clip.sourceId) : null
      if (!clip || source?.kind !== 'video' || !Array.isArray(operation.points) || operation.points.length < 2 || operation.points.length > 9) {
        throw new Error('变速曲线参数无效')
      }
      const points = operation.points.map(point => {
        if (!point || typeof point !== 'object' || Array.isArray(point)) throw new Error('变速点格式无效')
        const value = point as Record<string, unknown>
        if (typeof value.u !== 'number' || typeof value.speed !== 'number' || !Number.isFinite(value.u) || !Number.isFinite(value.speed)) throw new Error('变速点格式无效')
        return { u: value.u, speed: value.speed }
      })
      if (points[0]?.u !== 0 || points[points.length - 1]?.u !== 1
        || points.some((point, index) => point.u < 0 || point.u > 1 || point.speed < 0.25 || point.speed > 4
          || (index > 0 && point.u <= points[index - 1]!.u))) throw new Error('变速点必须从 0 到 1 连续递增，速度范围为 0.25–4')
      const curve = { interpolation: 'smooth' as const, points }
      const averageSpeed = clipAverageSpeed({ ...clip, speedCurve: curve })
      if (operation.preserve_duration === true) {
        const nextSourceDuration = Math.round(clipOutputDurationMs(clip) * averageSpeed)
        const nextEnd = clip.sourceStartMs + nextSourceDuration
        if (source.durationMs !== null && nextEnd > source.durationMs) throw new Error('素材长度不足以保持当前成片时长')
        clip.sourceEndMs = nextEnd
      }
      clip.speedCurve = curve
    } else if (action === 'fade') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const clip = clips.find(item => item.id === clipId)
      const fadeOutMs = operation.fade_out_ms
      if (!clip || typeof fadeOutMs !== 'number' || !Number.isInteger(fadeOutMs) || fadeOutMs < 0) throw new Error('片尾淡出参数无效')
      clip.fadeOutMs = fadeOutMs
    } else if (action === 'crop') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const clip = clips.find(item => item.id === clipId)
      if (!clip) throw new Error(`时间线片段不存在：${clipId}`)
      const crop = {
        left: typeof operation.crop_left === 'number' ? operation.crop_left : clip.crop?.left ?? 0,
        top: typeof operation.crop_top === 'number' ? operation.crop_top : clip.crop?.top ?? 0,
        width: typeof operation.crop_width === 'number' ? operation.crop_width : clip.crop?.width ?? 1,
        height: typeof operation.crop_height === 'number' ? operation.crop_height : clip.crop?.height ?? 1,
      }
      if (Object.values(crop).some(value => !Number.isFinite(value)) || crop.left < 0 || crop.top < 0
        || crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > 1 || crop.top + crop.height > 1) throw new Error('裁切参数无效')
      clip.crop = crop
    } else if (action === 'filter') {
      const id = typeof operation.filter_id === 'string' ? operation.filter_id : ''
      const intensity = typeof operation.intensity === 'number' ? operation.intensity : 100
      if (!filterIds.has(id) || !Number.isFinite(intensity) || intensity < 0 || intensity > 100) throw new Error('滤镜 ID 或强度无效')
      filter = { id, intensity, enabled: true }
    } else if (action === 'filter_enabled') {
      if (!filter || typeof operation.enabled !== 'boolean') throw new Error('当前工程没有可切换的滤镜')
      filter.enabled = operation.enabled
    } else if (action === 'remove_filter') {
      filter = null
    } else if (action === 'music_set') {
      const sourceId = typeof operation.source_id === 'string' ? operation.source_id : ''
      const source = sources.get(sourceId)
      if (!source || source.kind !== 'audio' || !source.durationMs) throw new Error(`配乐来源不存在：${sourceId}`)
      const start = typeof operation.start_ms === 'number' ? Math.round(operation.start_ms) : 0
      const duration = typeof operation.duration_ms === 'number' ? Math.round(operation.duration_ms) : source.durationMs - start
      const volume = typeof operation.volume === 'number' ? operation.volume : 0.75
      if (start < 0 || duration <= 0 || start + duration > source.durationMs || volume < 0 || volume > 1) throw new Error('配乐范围或音量无效')
      music = { sourceId, sourceStartMs: start, sourceEndMs: start + duration, volume }
      musicEnabled = true
    } else if (action === 'music_trim') {
      if (!music) throw new Error('当前工程没有配乐')
      const source = sources.get(music.sourceId)!
      const start = typeof operation.start_ms === 'number' ? Math.round(operation.start_ms) : music.sourceStartMs
      const duration = typeof operation.duration_ms === 'number' ? Math.round(operation.duration_ms) : music.sourceEndMs - music.sourceStartMs
      if (start < 0 || duration <= 0 || (source.durationMs !== null && start + duration > source.durationMs)) throw new Error('配乐裁剪范围无效')
      music = { ...music, sourceStartMs: start, sourceEndMs: start + duration }
    } else if (action === 'music_volume') {
      if (!music || typeof operation.volume !== 'number' || !Number.isFinite(operation.volume) || operation.volume < 0 || operation.volume > 1) throw new Error('配乐音量无效')
      music = { ...music, volume: operation.volume }
    } else if (action === 'music_enabled') {
      if (!music || typeof operation.enabled !== 'boolean') throw new Error('当前工程没有可切换的配乐')
      musicEnabled = operation.enabled
    } else if (action === 'remove_music') {
      music = null
      musicEnabled = true
    } else if (action === 'watermark') {
      const id = typeof operation.watermark_id === 'string' ? operation.watermark_id : watermark?.id ?? ''
      if (!watermarkIds.has(id)) throw new Error('水印 ID 无效')
      const width = typeof operation.watermark_width === 'number' ? operation.watermark_width : watermark?.width ?? 0.16
      const opacity = typeof operation.watermark_opacity === 'number' ? operation.watermark_opacity : watermark?.opacity ?? 1
      const anchor = typeof operation.watermark_anchor === 'string' ? operation.watermark_anchor : watermark?.positioning.anchor ?? 'bottom-right'
      const anchors = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center']
      const hasX = typeof operation.watermark_x === 'number'
      const hasY = typeof operation.watermark_y === 'number'
      if (!Number.isFinite(width) || width <= 0 || width > 0.5 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || !anchors.includes(anchor)
        || hasX !== hasY || (hasX && ((operation.watermark_x as number) < 0 || (operation.watermark_x as number) > 1
          || (operation.watermark_y as number) < 0 || (operation.watermark_y as number) > 1))) throw new Error('水印设置无效')
      const centerX = hasX ? operation.watermark_x as number : watermark?.positioning.centerX
      const centerY = hasY ? operation.watermark_y as number : watermark?.positioning.centerY
      watermark = { id, width, opacity, positioning: { anchor: anchor as WatermarkPositioning['anchor'], targetWidth: width,
        ...(centerX !== undefined && centerY !== undefined ? { centerX, centerY } : {
          marginX: watermark?.positioning.marginX ?? 0.04, marginY: watermark?.positioning.marginY ?? 0.04,
        }) } }
    } else if (action === 'remove') {
      const clipId = typeof operation.clip_id === 'string' ? operation.clip_id : ''
      const before = clips.length
      clips = clips.filter(clip => clip.id !== clipId)
      if (before === clips.length) throw new Error(`时间线片段不存在：${clipId}`)
    } else {
      throw new Error(`不支持的剪辑操作：${String(action)}`)
    }
  }
  clips = orderedTimelineClips(clips)
  return { ...project, clips, music, musicEnabled, filter, watermark }
}

export const aiEditingToolModule: LunaToolModule = {
  id: 'ai-editing-workspace',
  tools,
  allowedPurposes: allEditingPurposes,
  skills: [
    { id: 'footage-creation', purpose: 'footage-creation', description: '依据用户对照片或视频的点赞、评论和时间范围创建 Luna 剪辑工程；人工标注优先。', instructions: `# 素材创作（App footage-creation v6）\n\n本流程直接从已有素材创作，不要求先拍摄或跟随计划。拍摄计划需求使用 shooting。先调用 footage_find_annotated；默认最近 24 小时，用户说今天/昨天时按本地自然日，只有明确要求全部历史才 allTime=true。沿用真实 assetId。点赞、评论、点赞点和好片段是人工内容证据；评论不是视觉识别。只有 footage_inspect_asset 成功返回的真实帧才是画面观察；稀疏帧不能证明连续动作，也不能说明原声。\n\n用户只问评论含义时只读取并回答。用户明确要求做成片时，先按人工标注与用户目的选素材，必要时做最少量真实抽帧检查，再创建工程并用 editing_workspace_edit 组织镜头。不能凭文件名推断事件、画面或情绪，不因准备成片扫描整个素材库。\n\n所有写入使用当前 sessionId/revision 和最新 projectRevision；批量编辑一次提交、写入后重新读取。照片从源时间 0 开始并使用 1–30 秒展示时长。剪辑工程是可编辑草稿；只有主窗口的导出操作成功后才可说已导出。` },
    { id: 'editing-workspace', purpose: 'editing-workspace', description: '按 Luna App 工作区技能编辑真实 PC 剪辑工程，支持时间线、变速、调色、滤镜、水印、配乐与撤销。', instructions: `# 当前剪辑工作区（App editing-workspace v4）\n\n只编辑真实 LunaEditProject，不把拍摄计划当作时间线。先调用 editing_workspace_list / editing_workspace_read，使用实际 projectId、sourceId、clipId 和 projectRevision。按用户意图组织一次 editing_workspace_edit 批次；批次先整体校验再保存，失败不写入。可用 append、move、replace、slip、trim、remove、color、crop、photo_motion、speed_curve、fade、original_volume、filter、filter_enabled、remove_filter、music_set、music_trim、music_enabled、music_volume、remove_music、watermark。字段使用 App 工具 schema 的 snake_case；source_id 必须来自当前工程，不能猜路径。源区间和成片时间线分开，照片从源时间 0 开始且展示 1–30 秒。变速曲线使用 u=0..1、速度 0.25–4；需要时 preserve_duration 保持当前成片时长。滤镜与水印先查真实 ID。\n\n需要配乐时先读 editing_workspace_music_templates 或 editing_workspace_read_music_template，再根据工程时长组织 DSL 并调用 editing_workspace_generate_music；用户明确不要音乐时遵从。生成工具只在项目当前 revision 匹配时将新音轨加入工程。配乐从时间线 0 秒开始，与片段原声混音。\n\n每次写入后重新读取工程，不用旧快照覆盖用户手动改动。revision 冲突时以最新工程重算。用户要求撤销本 Agent 最近一批编辑时，先读取最新 revision，再用 editing_workspace_undo_task 和该任务返回的 taskId；若后续已有其他编辑则不覆盖。工程修改不等于导出；只有用户明确要求导出且主窗口成功返回路径后才可报告完成。` },
  ],
  async execute(name, args, context, callId) {
    if (!tools.some(item => item.name === name)) return null
    let started = Date.now()
    try {
      if (name === 'footage_find_annotated') {
        const baseDir = await context.aiEditorBaseDir?.()
        if (!baseDir) throw new AgentSessionError('UNSUPPORTED', '素材服务暂不可用')
        const data = await findAnnotated(args, baseDir)
        return { ok: true, result: addAgentContext({ ok: true, summary: `找到 ${data.total} 条已标注素材`, data }, context.agentSession) }
      }
      if (name === 'footage_read_project') {
        const baseDir = await context.aiEditorBaseDir?.()
        if (!baseDir || typeof args.projectId !== 'string') throw new AgentSessionError('INVALID_PARAMS', '选片项目编号无效')
        const data = await loadFootageSelectionProject(baseDir, args.projectId)
        return { ok: true, result: addAgentContext({ ok: true, summary: '已读取人工选片标注', data }, context.agentSession) }
      }
      if (name === 'footage_inspect_asset') {
        if (!Array.isArray(args.mediaIds) || args.mediaIds.length < 1 || args.mediaIds.length > 3
          || args.mediaIds.some(value => typeof value !== 'string')
          || (args.frameTimes !== undefined && (!args.frameTimes || typeof args.frameTimes !== 'object' || Array.isArray(args.frameTimes)))) {
          throw new AgentSessionError('INVALID_PARAMS', '视觉检查素材参数无效')
        }
        const frameTimes = args.frameTimes as Record<string, number[]> | undefined
        const requestedFrames = frameTimes ? Object.values(frameTimes).reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0) : 0
        if ((args.mode === 'detail' && args.mediaIds.length > 1) || requestedFrames > 3) {
          throw new AgentSessionError('INVALID_PARAMS', '一次视觉检查最多返回 3 帧；detail 模式每次只检查 1 个视频')
        }
        context.agentSession?.toolStarted(callId, name, args)
        const inspected = await inspectAiEditorLocalMedia(args.mediaIds as string[], {
          mode: args.mode === 'detail' ? 'detail' : 'overview',
          frameTimes,
        })
        if (inspected.items.reduce((count, item) => count + item.frames.length, 0) > 3) {
          throw new AgentSessionError('INVALID_PARAMS', '一次视觉检查最多返回 3 帧；请拆分素材请求')
        }
        const items = inspected.items.map(item => ({
          mediaId: item.mediaId, name: item.name, kind: item.kind, duration: item.duration,
          capturedAt: item.capturedAt, error: item.error,
          frames: item.frames.map(frame => ({ timeSec: frame.timeSec, mimeType: frame.mimeType })),
        }))
        const summary = `已检查 ${items.length} 个素材的真实抽帧`
        const structured = addAgentContext({ ok: true, summary, data: { mode: inspected.mode, maxWidth: inspected.maxWidth, items } }, context.agentSession)
        context.agentSession?.toolFinished(callId, name, args, true, summary, Date.now() - started)
        return { ok: true, result: structured, content: [
          { type: 'text', text: JSON.stringify(structured) },
          ...inspected.items.flatMap(item => item.frames.map(frame => ({ type: 'image' as const, data: frame.base64, mimeType: frame.mimeType }))),
        ] }
      }
      if (name === 'editing_workspace_music_templates') {
        const music = context.musicTools
        if (!music) throw new AgentSessionError('UNSUPPORTED', 'Luna 音乐引擎暂不可用')
        const templates = await music.listMusicTemplates({
          tag: typeof args.tag === 'string' ? args.tag : undefined,
          scene: typeof args.scene === 'string' ? args.scene : undefined,
          dialogueSafe: typeof args.dialogueSafe === 'boolean' ? args.dialogueSafe : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        })
        return { ok: true, result: addAgentContext({ ok: true, summary: `找到 ${templates.length} 个配乐模板`, data: { templates } }, context.agentSession) }
      }
      if (name === 'editing_workspace_read_music_template') {
        const music = context.musicTools
        if (!music || typeof args.templateId !== 'string') throw new AgentSessionError('INVALID_PARAMS', '配乐模板编号无效')
        const template = await music.getMusicTemplate(args.templateId)
        return { ok: true, result: addAgentContext({ ok: true, summary: `已读取配乐模板 ${args.templateId}`, data: { template } }, context.agentSession) }
      }
      const baseDir = await context.aiEditorBaseDir?.()
      if (!baseDir) throw new AgentSessionError('UNSUPPORTED', '剪辑工程服务暂不可用')
      if (name === 'editing_workspace_list') {
        const data = await listAiEditorProjects(baseDir)
        return { ok: true, result: addAgentContext({ ok: true, summary: `共有 ${data.length} 个剪辑工程`, data }, context.agentSession) }
      }
      if (name === 'editing_workspace_create') {
        const gate = sessionForWrite(context, args, allEditingPurposes)
        if (typeof args.name !== 'string' || !Array.isArray(args.mediaIds) || args.mediaIds.length < 1
          || args.mediaIds.some(value => typeof value !== 'string')) throw new AgentSessionError('INVALID_PARAMS', '剪辑工程参数无效')
        const selectedMedia = await Promise.all((args.mediaIds as string[]).map(getAiEditorLocalMedia))
        if (!selectedMedia.some(item => item.kind === 'video' || item.kind === 'image')) throw new AgentSessionError('INVALID_PARAMS', '剪辑工程至少需要一个视频或照片素材')
        const manager = gate.manager
        manager.toolStarted(callId, name, args)
        const created = await createAiEditorProject(baseDir, args.name)
        const project = await addAiEditorProjectMedia(baseDir, created.projectId, args.mediaIds as string[])
        manager.toolFinished(callId, name, args, true, '已创建剪辑工程', Date.now() - started)
        return { ok: true, result: addAgentContext({ ok: true, summary: '已创建剪辑工程', data: { projectId: project.id, projectName: project.name, revision: project.revision, sources: project.sources.map(({ id, mediaId, name, kind, durationMs }) => ({ id, mediaId, name, kind, durationMs })) } }, manager) }
      }
      if (name === 'editing_workspace_read') {
        if (typeof args.projectId !== 'string') throw new AgentSessionError('INVALID_PARAMS', '剪辑工程编号无效')
        const { project } = await loadAiEditorProject(baseDir, args.projectId)
        return { ok: true, result: addAgentContext({ ok: true, summary: '已读取剪辑工程', data: redactProject(project) }, context.agentSession) }
      }
      if (name === 'editing_workspace_filters') {
        const data = (await listAiEditorFilters()).map(({ id, name }) => ({ id, name }))
        return { ok: true, result: addAgentContext({ ok: true, summary: `找到 ${data.length} 个可用滤镜`, data }, context.agentSession) }
      }
      if (name === 'editing_workspace_watermarks') {
        const data = (await listAiEditorWatermarks()).map(({ id, name }) => ({ id, name }))
        return { ok: true, result: addAgentContext({ ok: true, summary: `找到 ${data.length} 个可用水印`, data }, context.agentSession) }
      }
      if (name === 'editing_workspace_generate_music') {
        const gate = sessionForWrite(context, args, allEditingPurposes)
        const musicTools = context.musicTools
        if (!musicTools) throw new AgentSessionError('UNSUPPORTED', 'Luna 音乐引擎暂不可用')
        if (typeof args.projectId !== 'string' || !Number.isInteger(args.projectRevision)
          || typeof args.dsl !== 'string' || !args.dsl.trim()) throw new AgentSessionError('INVALID_PARAMS', '配乐生成参数无效')
        const current = await loadAiEditorProject(baseDir, args.projectId)
        if (current.project.revision !== args.projectRevision) throw new AgentSessionError('REQUEST_UPDATED', '剪辑工程版本已变化，请重新读取后再生成配乐')
        gate.manager.toolStarted(callId, name, args)
        const generated = await musicTools.generateBackgroundMusic(args.dsl, typeof args.name === 'string' ? args.name : undefined)
        const saved = await setAiEditorProjectMusic(baseDir, args.projectId, current.project.revision, generated.mediaId,
          0.75, gate.session.sessionId, generated.musicTiming)
        const summary = `已生成并加入配乐：${generated.name}`
        gate.manager.toolFinished(callId, name, args, true, summary, Date.now() - started)
        return { ok: true, result: addAgentContext({ ok: true, summary, data: {
          mediaId: generated.mediaId, name: generated.name, durationSec: generated.durationSec, revision: saved.revision,
          project: redactProject(saved),
        } }, gate.manager) }
      }
      if (name === 'editing_workspace_undo_task') {
        const gate = sessionForWrite(context, args, allEditingPurposes)
        if (typeof args.projectId !== 'string' || typeof args.projectRevision !== 'number' || !Number.isInteger(args.projectRevision) || typeof args.taskId !== 'string') {
          throw new AgentSessionError('INVALID_PARAMS', '撤销参数无效')
        }
        gate.manager.toolStarted(callId, name, args)
        const project = await undoAiEditorProjectTask(baseDir, args.projectId, args.projectRevision, args.taskId)
        const summary = '已撤销最近一批 Agent 剪辑修改'
        gate.manager.toolFinished(callId, name, args, true, summary, Date.now() - started)
        return { ok: true, result: addAgentContext({ ok: true, summary, data: redactProject(project) }, gate.manager) }
      }
      if (name === 'editing_workspace_edit') {
        const gate = sessionForWrite(context, args, allEditingPurposes)
        if (typeof args.projectId !== 'string' || typeof args.projectRevision !== 'number' || !Number.isInteger(args.projectRevision) || !Array.isArray(args.operations)
          || args.operations.length < 1 || args.operations.length > 100) throw new AgentSessionError('INVALID_PARAMS', '剪辑操作参数无效')
        const { project } = await loadAiEditorProject(baseDir, args.projectId)
        if (project.revision !== args.projectRevision) throw new AgentSessionError('REQUEST_UPDATED', '剪辑工程版本已变化，请重新读取后再编辑')
        gate.manager.toolStarted(callId, name, args)
        const [filters, watermarks] = await Promise.all([listAiEditorFilters(), listAiEditorWatermarks()])
        const next = applyOperations(project, args.operations, new Set(filters.map(item => item.id)), new Set(watermarks.map(item => item.id)))
        const saved = await saveAiEditorProject(baseDir, next, project.revision, gate.session.sessionId)
        gate.manager.toolFinished(callId, name, args, true, `已应用 ${args.operations.length} 项剪辑操作`, Date.now() - started)
        return { ok: true, result: addAgentContext({ ok: true, summary: `已应用 ${args.operations.length} 项剪辑操作`, data: redactProject(saved) }, gate.manager) }
      }
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 剪辑操作失败'
      const failure = { code: error instanceof AgentSessionError ? error.code : 'AI_EDITING_FAILED', message, retryable: false }
      context.agentSession?.toolFinished(callId, name, args, false, message, Date.now() - started, failure)
      return { ok: true, result: addAgentContext({ ok: false, summary: message, error: failure }, context.agentSession) }
    }
  },
}
