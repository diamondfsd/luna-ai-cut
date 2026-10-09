import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

// Follow the emitted module graph, as it will be loaded outside the installer.
const root = path.resolve('dist-electron')
const visited = new Set()
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'electron'])
// The main process is emitted as ESM, where these CommonJS globals do not exist.
const ambientNames = new Set(['__dirname', '__filename'])
function visit(file) {
  if (visited.has(file)) return
  visited.add(file)
  assert.ok(existsSync(file), `Missing hot-update module: ${file}`)
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declaredAmbient = new Set()
  const usedAmbient = new Set()
  function walk(node) {
    if (ts.isPropertyAccessExpression(node)) {
      assert.notEqual(node.name.text, 'requestSingleInstanceLock', `Bootstrap leaked into ${file}`)
    }
    if (ts.isIdentifier(node) && ambientNames.has(node.text)) {
      const parent = node.parent
      const declaresHere = ts.isVariableDeclaration(parent) && parent.name === node
      ;(declaresHere ? declaredAmbient : usedAmbient).add(node.text)
    }
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text
      if (name.startsWith('.')) {
        const target = path.resolve(path.dirname(file), name)
        assert.notEqual(target, path.join(root, 'main.js'), 'Hot update must not import bootstrap')
        visit(target)
      } else assert.ok(builtins.has(name), `Installation-only dependency imported from hot directory: ${name}`)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  for (const name of usedAmbient) {
    assert.ok(
      declaredAmbient.has(name),
      `${name} is referenced from ${file} without a local definition; the ESM main process cannot provide it (bundled CommonJS dependency?)`,
    )
  }
}
visit(path.join(root, 'luna-appMain.js'))
console.log(`Hot-update entry verified (${visited.size} modules)`)
