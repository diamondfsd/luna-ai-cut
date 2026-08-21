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
  'luna-talking-head-editing',
  'luna-story-continuity',
  'luna-rhythm-pacing',
  'luna-audio-editing',
  'luna-caption-layout',
  'luna-polish-delivery',
  'luna-director-style-library',
]
for (const name of expectedSkillNames) assert.ok(loadedNames.includes(name))
assert.ok(loadedNames.length >= expectedSkillNames.length)
assert.equal(new Set(loadedNames).size, loadedNames.length)
assert.ok(loadedSkills.every(skill => skill.source === 'bundled'))
const freecutSkills = loadedSkills.filter(skill => skill.provider === 'luna-freecut-built-in')
assert.ok(freecutSkills.length >= expectedSkillNames.length)
const shotcraftSkill = loadedSkills.find(skill => skill.name === 'video-shotcraft')
assert.ok(shotcraftSkill)
assert.equal(shotcraftSkill.provider, 'luna-video-shotcraft')

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
  'luna-talking-head-editing': /完整音频字幕/u,
  'luna-story-continuity': /视线方向/u,
  'luna-rhythm-pacing': /固定秒数/u,
  'luna-audio-editing': /small-music/u,
  'luna-caption-layout': /addText/u,
  'luna-polish-delivery': /addTransition/u,
  'luna-wong-kar-wai': /gpu-motion-blur/u,
  'luna-director-style-library': /时间轴镜头表/u,
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
assert.match(wong.content, /slow_speed_range: \[0\.5, 0\.7\]/u)
assert.match(wong.content, /slow_speed_default: 0\.6/u)
assert.match(wong.content, /speed: 0\.6/u)
assert.match(wong.content, /shutterAngle: 360/u)
assert.match(wong.content, /inspectContext/u)

const directorLibrary = loadedSkills.find(skill => skill.name === 'luna-director-style-library')
assert.ok(directorLibrary)
assert.match(directorLibrary.content, /最多组合两个画像/u)
assert.match(directorLibrary.content, /真实 `mediaId`/u)
assert.match(directorLibrary.content, /luna\.timeline\.setProperties/u)
assert.match(directorLibrary.content, /gpu-motion-blur/u)
assert.match(directorLibrary.content, /完成认证/u)
assert.match(directorLibrary.content, /不复制外部 skill 的原文/u)

const talkingHead = loadedSkills.find(skill => skill.name === 'luna-talking-head-editing')
assert.ok(talkingHead)
assert.match(talkingHead.content, /media\.getAnalysisTask/u)
assert.match(talkingHead.content, /status === 'completed'/u)
assert.match(talkingHead.content, /words/u)
assert.match(talkingHead.content, /0\.15-0\.35/u)
assert.match(talkingHead.content, /自我纠正/u)
assert.match(talkingHead.content, /重新从保留的转录片段计算成片时间/u)
assert.match(talkingHead.content, /不把静音检测结果直接变成删除操作/u)

const registeredSkills = []
const registeredNames = await registerBuiltInSkills({
  skills: { register: skill => registeredSkills.push(skill) },
})
assert.deepEqual(registeredNames, loadedNames)
assert.deepEqual(registeredSkills.map(skill => skill.name), loadedNames)

console.log('DeepSeek Harness FreeCut tool result rendering passed.')
console.log('DeepSeek Harness Markdown skill registration passed.')
