import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadBuiltInSkills,
  registerBuiltInSkills,
} from './deepseek-harness-built-in-skills.mjs'
import { resolveVideoShotcraftRoot, VIDEO_SHOTCRAFT_COMMIT } from './video-shotcraft.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localRoot = resolveVideoShotcraftRoot(repoRoot)
assert.ok(localRoot, 'vendor/video-shotcraft must be present in the repository')

const skills = await loadBuiltInSkills()
const shotcraft = skills.find((skill) => skill.name === 'video-shotcraft')
assert.ok(shotcraft)
assert.equal(shotcraft.provider, 'luna-video-shotcraft')
assert.deepEqual(shotcraft.resourceBase, { kind: 'directory', path: localRoot })
assert.match(shotcraft.content, /Remotion/u)
assert.equal(skills.filter((skill) => skill.name === 'video-shotcraft').length, 1)

const registered = []
const registeredNames = await registerBuiltInSkills({
  skills: { register: (skill) => registered.push(skill) },
})
assert.ok(registeredNames.includes('video-shotcraft'))
assert.deepEqual(
  registered.find((skill) => skill.name === 'video-shotcraft').resourceBase,
  { kind: 'directory', path: localRoot },
)
assert.equal(VIDEO_SHOTCRAFT_COMMIT, '0d6f0b57f0d4d6700761644c07f7ef03c3e50234')

console.log('DeepSeek Harness video-shotcraft integration passed.')
