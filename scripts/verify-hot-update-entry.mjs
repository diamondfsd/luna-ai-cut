import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

// Follow the emitted module graph, as it will be loaded outside the installer.
const root = path.resolve('dist-electron')
const visited = new Set()
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'electron'])
function visit(file) {
  if (visited.has(file)) return
  visited.add(file)
  assert.ok(existsSync(file), `Missing hot-update module: ${file}`)
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  function walk(node) {
    if (ts.isPropertyAccessExpression(node)) {
      assert.notEqual(node.name.text, 'requestSingleInstanceLock', `Bootstrap leaked into ${file}`)
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
}
visit(path.join(root, 'luna-appMain.js'))
console.log(`Hot-update entry verified (${visited.size} modules)`)
