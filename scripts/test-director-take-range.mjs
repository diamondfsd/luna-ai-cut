import assert from 'node:assert/strict'
import { directorPreviewPath } from '../src/lib/directorMediaSource.ts'
import { validateDirectorTakeRange, directorPlanWithTakeRange, assertDirectorTakeRangesSaved } from '../src/lib/directorTakeRange.ts'
import { buildDirectorPlanUpdate, directorPlanContentSignature, overlayDirectorLocalPlan } from '../src/lib/directorPlanSync.ts'

const plan = {
  id: 'plan-range', title: '范围', attributes: [], shots: [{
    id: 'shot-1', name: '镜头', duration_ms: 5000, remark: '', attributes: [], takes: [{
      id: 'video-1', kind: 'video', duration_ms: 10000, selected_range: null,
      available: true, stream_url: 'file:///unchanged.mp4',
    }],
  }],
}
assert.equal(directorPreviewPath('file:///Users/test/%E7%B4%A0%E6%9D%90%20%231.mp4'), '/Users/test/素材 #1.mp4')
assert.equal(directorPreviewPath('file:///C:/clips/test%20video.mp4'), 'C:/clips/test video.mp4')
assert.equal(directorPreviewPath('file://server/share/video.mp4'), '//server/share/video.mp4')
assert.equal(directorPreviewPath('https://phone/video.mp4'), 'https://phone/video.mp4')
const selected = { start_ms: 2000, end_ms: 7000, note: '  保留转身后的画面  ' }
const edited = directorPlanWithTakeRange(plan, 'video-1', selected)
assert.equal(plan.shots[0].takes[0].selected_range, null)
assert.equal(edited.shots[0].takes[0].stream_url, plan.shots[0].takes[0].stream_url)
assert.equal(edited.shots[0].takes[0].selected_range.note, '保留转身后的画面')
assert.notEqual(directorPlanContentSignature(edited), directorPlanContentSignature(plan))
assert.deepEqual(buildDirectorPlanUpdate(edited, 1).shots[0].take_ranges, [{
  id: 'video-1', selected_range: { start_ms: 2000, end_ms: 7000, note: '保留转身后的画面' },
}])
assert.ok(!('take_ranges' in buildDirectorPlanUpdate(edited, 0, false).shots[0]))
assert.deepEqual(buildDirectorPlanUpdate({ ...edited, pending_take_ids: ['video-1'] }, 1).shots[0].take_ranges, [])
assertDirectorTakeRangesSaved(edited, edited)
assert.throws(() => assertDirectorTakeRangesSaved(edited, plan), /手机未保存片段标记/)
assert.throws(() => directorPlanWithTakeRange(plan, 'unknown', selected), /不属于/)
for (const invalid of [
  { start_ms: -1, end_ms: 5 }, { start_ms: 5, end_ms: 5 }, { start_ms: 0, end_ms: NaN },
  { start_ms: 0.5, end_ms: 5 }, { start_ms: 0, end_ms: 11000 },
  { start_ms: 0, end_ms: 5, note: 'a'.repeat(4001) },
]) assert.throws(() => validateDirectorTakeRange(invalid, 10000), /范围无效/)
const cleared = directorPlanWithTakeRange(edited, 'video-1', null)
assert.equal(directorPlanContentSignature(cleared), directorPlanContentSignature(plan))
const local = { ...edited, synced_signature: directorPlanContentSignature(plan),
  shots: edited.shots.map(shot => ({ ...shot, takes: shot.takes.map(take => ({ ...take, available: false, stream_url: null })) })),
}
const merged = overlayDirectorLocalPlan(plan, local)
assert.deepEqual(merged.shots[0].takes[0].selected_range, edited.shots[0].takes[0].selected_range)
assert.equal(merged.shots[0].takes[0].stream_url, 'file:///unchanged.mp4')
const clean = { ...plan, synced_signature: directorPlanContentSignature(plan) }
assert.deepEqual(overlayDirectorLocalPlan(edited, clean).shots[0].takes[0].selected_range, edited.shots[0].takes[0].selected_range)
console.log('director take range checks passed')
