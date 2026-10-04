import assert from 'node:assert/strict'
import { validateDirectorEditPlan } from '../electron/features/ai-editor/directorEditPlanValidation.ts'
const media = [{ mediaId: 'm1', kind: 'video', duration: 12, directorContexts: [{ planId: 'p', planSignature: 'current', shotId: 's', takeId: 't', selectedRange: { start_ms: 2000, end_ms: 8000 } }] }]
const plan = { planId: 'p', planSignature: 'current', segments: [{ mediaId: 'm1', shotId: 's', takeId: 't', inPoint: 2, outPoint: 6, timelineStart: 0, observation: { description: '主体走入画面', subject: '人物', framing: '中景', movement: '未知', usability: '可用', confidence: 0.7 }, reason: '主体入画', observedFrameTimes: [3, 5] }] }
assert.equal(validateDirectorEditPlan(plan, media).duration, 4)
for (const observedFrameTimes of [[1, 8], [6], [1.999]]) {
  assert.throws(() => validateDirectorEditPlan({ ...plan, segments: [{ ...plan.segments[0], observedFrameTimes }] }, media), /区间内/)
}
for (const observedFrameTimes of [[2], [1, 3, 8]]) {
  assert.equal(validateDirectorEditPlan({ ...plan, segments: [{ ...plan.segments[0], observedFrameTimes }] }, media).duration, 4)
}
for (const patch of [{ shotId: 'wrong' }, { takeId: 'wrong' }, { inPoint: 1 }, { outPoint: 9 }, { outPoint: 20 }, { inPoint: NaN }, { timelineStart: -1 }, { reason: '' }, { observedFrameTimes: [] }, { observedFrameTimes: [13] }, { observation: undefined }, { observation: { ...plan.segments[0].observation, confidence: 2 } }, { observation: { ...plan.segments[0].observation, description: '' } }]) {
  assert.throws(() => validateDirectorEditPlan({ ...plan, segments: [{ ...plan.segments[0], ...patch }] }, media))
}
assert.throws(() => validateDirectorEditPlan({ ...plan, planSignature: 'stale' }, media))
assert.throws(() => validateDirectorEditPlan(plan, [{ ...media[0], duration: undefined }]))
assert.throws(() => validateDirectorEditPlan({ ...plan, segments: [plan.segments[0], { ...plan.segments[0], timelineStart: 2 }] }, media))
assert.throws(() => validateDirectorEditPlan({ ...plan, segments: [plan.segments[0], { ...plan.segments[0], timelineStart: 4 }] }, media))
const image = [{ ...media[0], kind: 'image', duration: undefined }]
assert.equal(validateDirectorEditPlan({ ...plan, segments: [{ ...plan.segments[0], inPoint: 0, outPoint: 3, observedFrameTimes: [0] }] }, image).duration, 3)
console.log('Director edit ownership, stale snapshots, source limits, selections, evidence and overlap checks passed')

const plannedSegment = { ...plan.segments[0], selectionBasis: 'director-plan', observation: undefined, observedFrameTimes: undefined }
assert.equal(validateDirectorEditPlan({ ...plan, segments: [plannedSegment] }, media).duration, 4)
for (const patch of [{ observation: plan.segments[0].observation }, { observedFrameTimes: [3] }, { selectionBasis: 'invented' }, { outPoint: 9 }, { takeId: 'wrong' }]) {
  assert.throws(() => validateDirectorEditPlan({ ...plan, segments: [{ ...plannedSegment, ...patch }] }, media))
}
assert.throws(() => validateDirectorEditPlan({ ...plan, segments: [{ ...plannedSegment, selectionBasis: 'visual-inspection' }] }, media))
