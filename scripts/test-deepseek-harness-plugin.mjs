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
const expectedSkillNames = [
  'luna-editing-master',
  'luna-editing-standard',
  'luna-rough-cut',
  'luna-story-continuity',
  'luna-rhythm-pacing',
  'luna-audio-editing',
  'luna-caption-layout',
  'luna-polish-delivery',
]
for (const name of expectedSkillNames) assert.ok(loadedNames.includes(name))
assert.ok(loadedNames.length >= expectedSkillNames.length)
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
assert.match(master.content, /timeline\.effects\.add/u)
assert.match(master.content, /0.*不是静音/u)
assert.doesNotMatch(master.content, /调用 `media\.list`/u)
assert.doesNotMatch(master.content, /没有接通记忆|未公开的素材分析|未公开的.*音频生成/u)

const standard = loadedSkills.find(skill => skill.name === 'luna-editing-standard')
assert.ok(standard)
assert.match(standard.content, /证据优先/u)
assert.match(standard.content, /media\.getAnalysisTask/u)
assert.match(standard.content, /edit\.run_script/u)
assert.match(standard.content, /crossfade/u)
assert.match(standard.content, /复核/u)

const skillMarkers = {
  'luna-rough-cut': /media\.analyze/u,
  'luna-story-continuity': /视线方向/u,
  'luna-rhythm-pacing': /固定秒数/u,
  'luna-audio-editing': /small-music/u,
  'luna-caption-layout': /addText/u,
  'luna-polish-delivery': /addTransition/u,
  'luna-wong-kar-wai': /gpu-motion-blur/u,
}
for (const [name, marker] of Object.entries(skillMarkers)) {
  const skill = loadedSkills.find(candidate => candidate.name === name)
  assert.ok(skill)
  assert.match(skill.content, marker)
}

const wong = loadedSkills.find(skill => skill.name === 'luna-wong-kar-wai')
assert.ok(wong)
assert.match(wong.content, /不复制具体电影/u)
assert.match(wong.content, /inspectContext/u)
assert.match(wong.content, /gpu-temperature/u)
assert.match(wong.content, /步进印片/u)

const registeredSkills = []
const registeredNames = await registerBuiltInSkills({
  skills: { register: skill => registeredSkills.push(skill) },
})
assert.deepEqual(registeredNames, loadedNames)
assert.deepEqual(registeredSkills.map(skill => skill.name), loadedNames)

console.log('DeepSeek Harness FreeCut tool result rendering passed.')
console.log('DeepSeek Harness Markdown skill registration passed.')
