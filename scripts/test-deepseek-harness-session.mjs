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
  assert.match(firstAgents, /当前打开的剪辑项目/u)
  assert.match(firstAgents, /projectId: "project-current"/u)
  assert.match(firstAgents, /projectName: "当前剪辑项目"/u)
  assert.equal(firstAgents.split('luna-ai-cut:current-project:start').length - 1, 1)

  await writeFile(path.join(root, 'AGENTS.md'), `${firstAgents}\n## User additions\nKeep this section.\n`, 'utf8')
  await prepareHarnessSession(root, pluginSource, {
    projectId: 'project-next',
    projectName: '下一个项目',
  })
  const secondAgents = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
  assert.equal(secondAgents.split('luna-ai-cut:default-agents:start').length - 1, 1)
  assert.equal(secondAgents.split('luna-ai-cut:current-project:start').length - 1, 1)
  assert.match(secondAgents, /projectId: "project-next"/u)
  assert.match(secondAgents, /## User additions\nKeep this section\./u)
  assert.equal(secondAgents, `${defaultSessionAgents({ projectId: 'project-next', projectName: '下一个项目' })}\n\n## User additions\nKeep this section.\n`)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DeepSeek Harness session bootstrap passed.')
