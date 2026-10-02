import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

function load(relative) {
  const file = new URL(relative, import.meta.url)
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(createRequire(file), module, module.exports)
  return module.exports
}

const events = new EventTarget()
globalThis.window = events
window.location = { hash: '#/ai-editor' }
globalThis.document = { documentElement: {}, body: {} }
const runtime = load('../vendor/openreel/apps/web/src/luna/embedded-runtime.ts')
const root = {}
runtime.setEmbeddedRoot(root)
let routeEvents = 0
window.addEventListener('luna-openreel-route', () => routeEvents++)
runtime.setEditorHash('#/luna-editor?projectId=p1')
assert.equal(window.location.hash, '#/ai-editor', 'editor navigation must not change Luna route')
assert.equal(runtime.editorHash(), '#/luna-editor?projectId=p1')
assert.equal(routeEvents, 1)
assert.equal(runtime.editorRoot(), root)
assert.equal(runtime.editorPortalRoot(), root)
runtime.setEmbeddedRoot(null)
runtime.setEditorHash('#/projects')
assert.equal(window.location.hash, '#/projects', 'standalone navigation remains compatible')

const require = createRequire(new URL('../vendor/openreel/apps/web/package.json', import.meta.url))
const postcss = require('postcss')
const { lunaCssScope } = load('../vendor/openreel/apps/web/vite-plugins/luna-css-scope.ts')
const css = await postcss([lunaCssScope()]).process(
  ':root {--blue: red} body {margin:0} :is(.one,.two) > button {color:red} @keyframes spin {from {opacity:0} to {opacity:1}}',
  { from: undefined },
)
assert.ok(css.css.includes('.luna-openreel {--blue: red}'))
assert.ok(css.css.includes('.luna-openreel :is(.one,.two) > button'))
assert.ok(css.css.includes('from {opacity:0}'), 'keyframe steps must not be scoped')
assert.ok(!css.css.includes('.luna-openreel from'))
delete globalThis.window
delete globalThis.document
console.log('OpenReel component route and CSS isolation checks passed')
