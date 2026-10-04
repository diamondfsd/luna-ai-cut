import assert from 'node:assert/strict'
import { directorMediaCandidates } from '../electron/features/ai-editor/aiEditorDirectorMedia.ts'
const plan = { id: 'p', title: '旅程', source: 'local', attributes: [], main_content: '到达城市', shots: [
  { id: 's', order: 1, name: '到达', attributes: [], remark: '', duration_ms: 5000,
    shot_recipe: { version: 1, extension: { motion: 'push' } }, takes: [
      { id: 't', kind: 'video', available: true, stream_path: '/tmp/t.mp4', file_name: 't.mp4',
        created_at: '2026-10-04T00:00:00Z', duration_ms: 10000, selected_range: { start_ms: 2000, end_ms: 7000 },
        markers: [{ id: 'm', start_ms: 3000, end_ms: null, text: '入画' }] },
      { id: 'missing', available: false, stream_path: '/tmp/missing.mp4' },
    ] },
] }
const candidates = directorMediaCandidates([plan])
assert.equal(candidates.length, 1)
assert.equal(candidates[0].duration, 10)
const context = candidates[0].directorContexts[0]
assert.equal(context.planId, 'p')
assert.equal(context.shotId, 's')
assert.equal(context.takeId, 't')
assert.deepEqual(context.recipe, plan.shots[0].shot_recipe)
assert.deepEqual(context.selectedRange, { start_ms: 2000, end_ms: 7000 })
assert.deepEqual(context.markers, plan.shots[0].takes[0].markers)
assert.equal(directorMediaCandidates([{ ...plan, source: 'remote' }]).length, 0)
assert.equal(directorMediaCandidates([{ ...plan, shots: [{ ...plan.shots[0], takes: [{ ...plan.shots[0].takes[0], stream_path: null }] }] }]).length, 0)
console.log('Director media identity, intent and unavailable/remote exclusion passed')
