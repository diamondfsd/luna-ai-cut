import assert from 'node:assert/strict'
import {
  FREECUT_EXPOSED_TOOL_NAMES,
  renderToolResult,
} from './deepseek-harness-freecut-plugin.mjs'
import {
  loadBuiltInSkills,
  registerBuiltInSkills,
} from './deepseek-harness-built-in-skills.mjs'

assert.deepEqual(FREECUT_EXPOSED_TOOL_NAMES, ['edit.run_script'])

const result = {
  ok: true,
  message: '已读取当前剪辑项目。',
  data: {
    tracks: [{ id: 'track-1', name: 'V1', itemCount: 1 }],
    items: [{ id: 'clip-1', mediaId: 'media-1', fromSeconds: 0, toSeconds: 8 }],
  },
}

const rendered = renderToolResult({}, result)
assert.equal(rendered.length, 1)
assert.equal(rendered[0].type, 'text')
assert.deepEqual(JSON.parse(rendered[0].text), result)
assert.match(rendered[0].text, /clip-1/)
assert.match(rendered[0].text, /media-1/)

const loadedSkills = await loadBuiltInSkills()
const loadedNames = loadedSkills.map(skill => skill.name)
assert.ok(loadedNames.includes('luna-editing-master'))
assert.equal(new Set(loadedNames).size, loadedNames.length)
assert.ok(loadedSkills.every(skill => skill.source === 'bundled'))
assert.ok(loadedSkills.every(skill => skill.provider === 'luna-freecut-built-in'))

const master = loadedSkills.find(skill => skill.name === 'luna-editing-master')
assert.ok(master)
assert.match(master.content, /创作简报/u)
assert.match(master.content, /AI 剪辑执行契约/u)
assert.match(master.content, /剪辑资料来源/u)
assert.match(master.content, /edit\.run_script/u)
assert.match(master.content, /luna\.media\.list/u)
assert.match(master.content, /memory\.(read|search|update|remove)/u)
assert.match(master.content, /media\.analyze/u)
assert.match(master.content, /media\.getAnalysisTask/u)
assert.match(master.content, /audio\.startSpeech/u)
assert.match(master.content, /audio\.startMusic/u)
assert.match(master.content, /audio\.getTask/u)
assert.match(master.content, /completed/u)
assert.match(master.content, /small-sfx/u)
assert.match(master.content, /timeline\.unlink/u)
assert.match(master.content, /timeline\.mute/u)
assert.match(master.content, /0.*不是静音/u)
assert.doesNotMatch(master.content, /调用 `media\.list`/u)
assert.doesNotMatch(master.content, /没有接通记忆|未公开的素材分析|未公开的.*音频生成/u)

const registeredSkills = []
const registeredNames = await registerBuiltInSkills({
  skills: { register: skill => registeredSkills.push(skill) },
})
assert.deepEqual(registeredNames, loadedNames)
assert.deepEqual(registeredSkills.map(skill => skill.name), loadedNames)

console.log('DeepSeek Harness FreeCut tool result rendering passed.')
console.log('DeepSeek Harness Markdown skill registration passed.')
