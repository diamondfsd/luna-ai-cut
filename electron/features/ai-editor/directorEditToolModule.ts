import { directorEditCoverage } from './directorEditCoverage.ts'
import { requestRendererWithCancellation } from '../../mcp/lunaMcpTaskTools.ts'
import { assertInspectionEvidence, inspectionFileIdentity } from './aiEditorInspectionEvidence.ts'
import type { LunaToolModule } from '../../mcp/lunaToolModule.ts'
import { validateDirectorEditPlan } from './directorEditPlanValidation.ts'

export const directorEditToolModule: LunaToolModule = {
  id: 'director-editing', allowedPurposes: ['editing'],
  tools: [{ name: 'validate_director_edit_plan',
    description: 'Validate a proposed director montage against current shot/take ownership, plan signature, probed source durations and selected ranges. Read-only; does not apply a timeline. Plan-based segments need no visual inspection; visually inspected segments require observation and actual frames. Referenced timestamps must have been extracted from the unchanged original file in this application session. This does not verify semantic conclusions.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['plan'], properties: {
      plan: { type: 'object', additionalProperties: false, required: ['planId', 'planSignature', 'segments'], properties: {
        planId: { type: 'string' }, planSignature: { type: 'string' }, omittedShots: { type: 'array', maxItems: 500, items: { type: 'object', required: ['shotId', 'reason'], properties: { shotId: { type: 'string' }, reason: { type: 'string' } } } }, segments: { type: 'array', minItems: 1, maxItems: 500,
          items: { type: 'object', required: ['mediaId', 'shotId', 'takeId', 'inPoint', 'outPoint', 'timelineStart', 'reason'], properties: {
            mediaId: { type: 'string' }, shotId: { type: 'string' }, takeId: { type: 'string' },
            inPoint: { type: 'number', minimum: 0 }, outPoint: { type: 'number' }, timelineStart: { type: 'number', minimum: 0 },
            selectionBasis: { type: 'string', enum: ['director-plan', 'visual-inspection'], description: 'director-plan assembles from user planning without frames or observation; visual-inspection requires actual frame references and observation. Omitted defaults to visual-inspection for compatibility.' },
            observation: { type: 'object', required: ['description', 'subject', 'framing', 'movement', 'usability', 'confidence'], properties: { description: { type: 'string' }, subject: { type: 'string' }, framing: { type: 'string' }, movement: { type: 'string' }, usability: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } } },
            reason: { type: 'string' }, observedFrameTimes: { type: 'array', items: { type: 'number', minimum: 0 } },
          } },
        },
      } },
    } },
  }],
  execute: async (name, args, context, callId) => {
    if (name === 'get_director_edit_target') return requestRendererWithCancellation(context, { callId, kind: 'callTool', name, args: {} })
    if (!['validate_director_edit_plan', 'apply_director_edit_plan'].includes(name)) return null
    try {
      const initialGate = name === 'apply_director_edit_plan' ? context.agentSession?.gateActiveTool() : undefined
      if (name === 'apply_director_edit_plan' && (!initialGate?.allowed || initialGate.session.purpose !== 'editing')) throw new Error('请先领取剪辑任务')
      const execution = initialGate ? { sessionId: initialGate.session.sessionId, revision: initialGate.session.revision } : null
      const boundPlanId = initialGate?.session.directorPlanRef?.planId
      const proposed = args.plan as { planId?: string; segments?: { mediaId?: string }[] } | undefined
      if (Object.keys(args).some(key => !['plan', 'projectId', 'expectedModifiedAt', 'trackId'].includes(key)) || !proposed || !Array.isArray(proposed.segments)
        || proposed.segments.length > 500 || proposed.segments.some(item => !item || typeof item.mediaId !== 'string')) throw new Error('剪辑方案无效')
      if (boundPlanId && proposed.planId !== boundPlanId) throw new Error('剪辑方案与当前任务的拍摄计划不一致')
      const ids = [...new Set(proposed.segments.map(item => item.mediaId as string))]
      const { getAiEditorLocalMediaFiles } = await import('./aiEditorLocalMediaService')
      const { getAiEditorLocalMediaMetadata } = await import('./aiEditorMediaMetadataService')
      const files = await getAiEditorLocalMediaFiles(ids)
      const metadata = await getAiEditorLocalMediaMetadata(files.filter(item => item.kind === 'video').map(item => item.mediaId))
      const durations = new Map(metadata.map(item => [item.mediaId, item.durationSec]))
      const data = validateDirectorEditPlan(args.plan, files.map(file => ({ ...file,
        duration: file.kind === 'video' ? durations.get(file.mediaId) ?? undefined : file.duration })))
      const { getSettings, getDirectorPlanDir } = await import('../../storage/fileService')
      const { listLocalDirectorPlans } = await import('../director-lab/directorLabPlanReader.ts')
      const source = (await listLocalDirectorPlans(getDirectorPlanDir(await getSettings()))).find(plan => plan.id === data.plan.planId)
      if (!source) throw new Error('拍摄计划不存在或未下载')
      const coverage = directorEditCoverage(data.plan, source)
      const verifiedFingerprints = new Map<string, string>()
      for (const segment of data.plan.segments) {
        const file = files.find(item => item.mediaId === segment.mediaId)!
        verifiedFingerprints.set(segment.mediaId, segment.selectionBasis === 'director-plan'
          ? await inspectionFileIdentity(file.filePath)
          : await assertInspectionEvidence(segment.mediaId, file.filePath, segment.observedFrameTimes!))
      }
      if (name === 'apply_director_edit_plan') {
        const gate = context.agentSession?.gateActiveTool()
        if (!gate?.allowed || gate.session.purpose !== 'editing' || gate.session.sessionId !== execution?.sessionId || gate.session.revision !== execution?.revision) throw new Error('请先领取剪辑任务')
        if (typeof args.projectId !== 'string' || typeof args.trackId !== 'string' || !Number.isFinite(args.expectedModifiedAt)) throw new Error('请提供当前项目和轨道版本')
        const segments = data.plan.segments.map(segment => ({ ...segment, sourceFingerprint: verifiedFingerprints.get(segment.mediaId) }))
        return await requestRendererWithCancellation(context, { callId, kind: 'callTool', name, args: {
          sessionId: gate.session.sessionId, revision: gate.session.revision,
          planId: data.plan.planId, planSignature: data.plan.planSignature,
          projectId: args.projectId, expectedModifiedAt: args.expectedModifiedAt, trackId: args.trackId, segments, coverage,
        } })
      }
      return { ok: true, result: { ok: true, data: { ...data, coverage } } }
    } catch (error) {
      const result = { ok: false, error: { code: 'INVALID_DIRECTOR_EDIT_PLAN', message: error instanceof Error ? error.message : String(error) } }
      return { ok: true, result }
    }
  },
}

const validationTool = directorEditToolModule.tools[0]
directorEditToolModule.tools = [...directorEditToolModule.tools, { name: 'get_director_edit_target', description: 'Read current project identity, modifiedAt version and tracks before applying a director edit. Does not change the project.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }, {
  name: 'apply_director_edit_plan', description: 'Revalidate current director footage and place selected imported media on an empty unlocked track as one undoable transaction. Requires a claimed editing task and current project version; does not import or export.',
  inputSchema: { ...validationTool.inputSchema, required: ['plan', 'projectId', 'expectedModifiedAt', 'trackId'], properties: {
    ...(validationTool.inputSchema.properties as Record<string, unknown>), projectId: { type: 'string' }, trackId: { type: 'string' }, expectedModifiedAt: { type: 'number' },
  } },
}]
