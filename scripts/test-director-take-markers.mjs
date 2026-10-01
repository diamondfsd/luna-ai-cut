import assert from 'node:assert/strict'
import { validateDirectorTakeMarkers, directorPlanWithTakeMarkers, directorMarkerTime } from '../src/lib/directorTakeMarkers.ts'
import { directorPlanWithTakeRange, assertDirectorTakeRangesSaved } from '../src/lib/directorTakeRange.ts'
import { buildDirectorPlanUpdate, directorPlanContentSignature, overlayDirectorLocalPlan } from '../src/lib/directorPlanSync.ts'
import { manifestForPlan } from '../electron/features/director-lab/directorLabPlanStorage.ts'

const plan = { id: 'plan-1', title: 'Plan', attributes: [], shots: [{ id: 'shot-1', name: 'Shot', order: 1,
  attributes: [], remark: '', duration_ms: 5000, takes: [{ id: 'video-1', kind: 'video', file_name: 'clip.mp4',
    duration_ms: 10000, selected_range: { start_ms: 0, end_ms: 5000 }, available: true, stream_url: 'file:///clip.mp4' }] }] }
const markers = [{ id: 'range-1', start_ms: 4000, end_ms: 6000, text: '转身亮点' },
  { id: 'point-1', start_ms: 1234, end_ms: null, text: '  表情亮点  ' }]
const edited = directorPlanWithTakeMarkers(plan, 'video-1', markers)
const take = edited.shots[0].takes[0]
assert.equal(directorMarkerTime(1234), '00:01.234')
assert.equal(directorMarkerTime(59999), '00:59.999')
assert.equal(plan.shots[0].takes[0].markers, undefined)
assert.equal(take.markers[0].start_ms, 1234)
assert.equal(take.markers[0].end_ms, null)
assert.equal(take.markers[0].text, '表情亮点')
assert.equal(take.stream_url, plan.shots[0].takes[0].stream_url)
assert.deepEqual(take.selected_range, plan.shots[0].takes[0].selected_range)
assert.notEqual(directorPlanContentSignature(plan), directorPlanContentSignature(edited))
assert.deepEqual(buildDirectorPlanUpdate(edited, 1).shots[0].take_ranges[0].markers, take.markers)
assert.ok(!('take_ranges' in buildDirectorPlanUpdate(edited, 0, false).shots[0]))
assert.deepEqual(directorPlanWithTakeRange(edited, 'video-1', null).shots[0].takes[0].markers, take.markers)
assert.deepEqual(JSON.parse(manifestForPlan(edited)).shots[0].media[0].markers, take.markers)
assertDirectorTakeRangesSaved(edited, edited)
assert.throws(() => assertDirectorTakeRangesSaved(edited, plan), /手机未保存亮点标签/)
const cleared = directorPlanWithTakeMarkers(edited, 'video-1', [])
assert.equal(directorPlanContentSignature(cleared), directorPlanContentSignature(plan))
assert.deepEqual(buildDirectorPlanUpdate(cleared, 1).shots[0].take_ranges[0].markers, [])
const local = { ...edited, synced_signature: directorPlanContentSignature(plan) }
assert.deepEqual(overlayDirectorLocalPlan(plan, local).shots[0].takes[0].markers, take.markers)
assert.deepEqual(overlayDirectorLocalPlan(edited, { ...plan, synced_signature: directorPlanContentSignature(plan) }).shots[0].takes[0].markers, take.markers)
for (const invalid of [null, [{}], [{ ...markers[0], start_ms: -1 }], [{ ...markers[0], start_ms: 0.5 }],
  [{ ...markers[0], end_ms: 4000 }], [{ ...markers[0], end_ms: 10001 }], [{ ...markers[0], text: '' }],
  [{ ...markers[0], text: 'x'.repeat(1001) }], [markers[0], markers[0]], [{ ...markers[0], id: '../bad' }],
  Array.from({ length: 201 }, (_, index) => ({ ...markers[0], id: `marker-${index}` }))]) {
  assert.throws(() => validateDirectorTakeMarkers(invalid, 10000), /亮点标签无效/)
}
assert.throws(() => directorPlanWithTakeMarkers(plan, 'unknown', markers), /不属于/)
console.log('director point and range marker checks passed')
