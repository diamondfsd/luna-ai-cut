import assert from 'node:assert/strict'
import { directorEditCoverage } from '../electron/features/ai-editor/directorEditCoverage.ts'
import { directorPlanContentSignature } from '../src/lib/directorPlanSync.ts'
const source = { id: 'p', title: 'Story', attributes: [], shots: [
  { id: 'start', name: 'Opening', duration_ms: 3000, remark: '', attributes: [], takes: [{ id: 't', available: true }] },
  { id: 'end', name: 'Ending', duration_ms: 3000, remark: '', attributes: [], takes: [] },
] }
const proposal = { planId: 'p', planSignature: directorPlanContentSignature(source), segments: [{ shotId: 'start', takeId: 't' }] }
assert.throws(() => directorEditCoverage(proposal, source), /未选用镜头/)
const complete = { ...proposal, omittedShots: [{ shotId: 'end', reason: '没有拍到结尾' }] }
assert.deepEqual(directorEditCoverage(complete, source), { plannedShots: 2, representedShots: 1, omittedShots: [{ shotId: 'end', name: 'Ending', hasAvailableFootage: false, reason: '没有拍到结尾' }] })
assert.throws(() => directorEditCoverage({ ...complete, planSignature: 'stale' }, source), /已更新/)
assert.throws(() => directorEditCoverage({ ...complete, omittedShots: [{ shotId: 'start', reason: 'wrong' }] }, source), /不一致/)
assert.throws(() => directorEditCoverage({ ...complete, omittedShots: [{ shotId: 'end', reason: '' }] }, source), /无效/)
assert.throws(() => directorEditCoverage({ ...complete, omittedShots: [complete.omittedShots[0], complete.omittedShots[0]] }, source), /无效/)
assert.throws(() => directorEditCoverage(complete, { ...source, shots: [{ ...source.shots[0], takes: [{ id: 'replacement', available: true }] }, source.shots[1]] }), /归属/)
assert.throws(() => directorEditCoverage(complete, { ...source, shots: [{ ...source.shots[0], takes: [{ id: 't', available: false }] }, source.shots[1]] }), /归属/)
console.log('Director story coverage, explicit omissions and stale-plan rejection passed')
