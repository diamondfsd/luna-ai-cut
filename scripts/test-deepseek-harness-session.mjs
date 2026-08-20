import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { defaultSessionAgents, prepareHarnessSession } from '../electron/deepseekHarnessSession.ts'

const root = await mkdtemp(path.join(tmpdir(), 'luna-deepseek-session-'))
const pluginSource = path.join(root, 'application-plugin.mjs')
await writeFile(pluginSource, 'export function apply() {}\n', 'utf8')

try {
  const patchPath = await prepareHarnessSession(root, pluginSource, {
    projectId: 'project-current',
    projectName: '当前剪辑项目',
  })
  const patch = parse(await readFile(patchPath, 'utf8'))
  assert.deepEqual(patch, [{
    insert: [{
      id: 'luna-freecut-sdk',
      name: path.join(root, 'luna-freecut-plugin.mjs'),
      config: { registerBuiltInSkills: false },
    }],
  }])

  const bridge = await readFile(path.join(root, 'luna-freecut-plugin.mjs'), 'utf8')
  assert.match(bridge, /export \* from "file:/u)
  assert.match(bridge, /application-plugin\.mjs/u)

  const firstAgents = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
  assert.equal(firstAgents.includes('edit.run_script'), true)
  assert.equal(firstAgents.includes('luna.timeline.inspectContext'), true)
  assert.match(firstAgents, /memory\.(read|search|update|remove)/u)
  assert.match(firstAgents, /media\.analyze/u)
  assert.match(firstAgents, /media\.getAnalysisTask/u)
  assert.match(firstAgents, /audio\.startSpeech/u)
  assert.match(firstAgents, /audio\.startMusic/u)
  assert.match(firstAgents, /audio\.getTask/u)
  assert.match(firstAgents, /small-sfx/u)
  assert.match(firstAgents, /completed/u)
  assert.doesNotMatch(firstAgents, /没有接通记忆|没有接通.*TTS/u)
  assert.match(firstAgents, /当前项目上下文/u)
  assert.match(firstAgents, /PROJECT\.md/u)
  assert.doesNotMatch(firstAgents, /project-current/u)
  assert.doesNotMatch(firstAgents, /当前剪辑项目/u)
  assert.equal(firstAgents.split('luna-ai-cut:current-project:start').length - 1, 0)
  const firstProject = await readFile(path.join(root, 'PROJECT.md'), 'utf8')
  assert.match(firstProject, /projectId: "project-current"/u)
  assert.match(firstProject, /projectName: "当前剪辑项目"/u)

  await writeFile(path.join(root, 'AGENTS.md'), `${firstAgents}\n## User additions\nKeep this section.\n`, 'utf8')
  await prepareHarnessSession(root, pluginSource, {
    projectId: 'project-next',
    projectName: '下一个项目',
  })
  const secondAgents = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
  assert.equal(secondAgents.split('luna-ai-cut:default-agents:start').length - 1, 1)
  assert.equal(secondAgents.split('luna-ai-cut:current-project:start').length - 1, 0)
  assert.doesNotMatch(secondAgents, /project-next/u)
  assert.match(secondAgents, /## User additions\nKeep this section\./u)
  assert.equal(secondAgents, `${defaultSessionAgents()}\n\n## User additions\nKeep this section.\n`)
  const secondProject = await readFile(path.join(root, 'PROJECT.md'), 'utf8')
  assert.match(secondProject, /projectId: "project-next"/u)
  assert.match(secondProject, /projectName: "下一个项目"/u)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DeepSeek Harness session bootstrap passed.')
