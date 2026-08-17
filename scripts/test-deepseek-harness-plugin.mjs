import assert from 'node:assert/strict'
import {
  FREECUT_AUDIO_TOOL_NAMES,
  FREECUT_MEMORY_TOOL_NAMES,
  renderToolResult,
} from './deepseek-harness-freecut-plugin.mjs'
import {
  BUILT_IN_SKILL_NAMES,
  loadBuiltInSkills,
  registerBuiltInSkills,
} from './deepseek-harness-built-in-skills.mjs'

assert.deepEqual(FREECUT_MEMORY_TOOL_NAMES, [
  'memory.read',
  'memory.search',
  'memory.update',
  'memory.remove',
])

assert.deepEqual(FREECUT_AUDIO_TOOL_NAMES, [
  'audio.generate_speech',
  'audio.generate_music',
])

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
assert.deepEqual(loadedSkills.map(skill => skill.name), BUILT_IN_SKILL_NAMES)
assert.ok(loadedSkills.every(skill => skill.source === 'bundled'))
assert.ok(loadedSkills.every(skill => skill.provider === 'luna-freecut-built-in'))
const master = loadedSkills.find(skill => skill.name === 'luna-editing-master')
assert.ok(master)
assert.match(master.content, /创作需求简报/)
assert.match(master.content, /AI 剪辑执行契约/)

const registeredSkills = []
const registeredNames = await registerBuiltInSkills({
  skills: { register: skill => registeredSkills.push(skill) },
})
assert.deepEqual(registeredNames, BUILT_IN_SKILL_NAMES)
assert.deepEqual(registeredSkills.map(skill => skill.name), BUILT_IN_SKILL_NAMES)

console.log('DeepSeek Harness FreeCut tool result rendering passed.')
console.log('DeepSeek Harness built-in editing skills registration passed.')
