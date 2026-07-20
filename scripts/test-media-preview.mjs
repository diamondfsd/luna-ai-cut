import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/components/htmlPreviewGeometry.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const geometry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`)
}

const landscape = geometry.containPreviewSize({ width: 1000, height: 800 }, { width: 1920, height: 1080 })
close(landscape.width, 1000, 'landscape preview width')
close(landscape.height, 562.5, 'landscape preview height')
const portrait = geometry.containPreviewSize({ width: 1000, height: 800 }, { width: 1080, height: 1920 })
close(portrait.width, 450, 'rotated portrait preview width')
close(portrait.height, 800, 'rotated portrait preview height')

const layer = {
  positioning: {
    landscape: { anchor: 'bottom-right', targetWidth: 0.22, marginX: 0.03, marginY: 0.05 },
    portrait: { anchor: 'bottom-center', targetWidth: 0.39, marginX: 0.03, marginY: 0.03 },
  },
}
assert.equal(geometry.resolveWatermarkPositioning(layer, { width: 1920, height: 1080 }).anchor, 'bottom-right')
assert.equal(geometry.resolveWatermarkPositioning(layer, { width: 1080, height: 1920 }).anchor, 'bottom-center')
assert.deepEqual(
  geometry.watermarkPositionStyle({ anchor: 'bottom-center', targetWidth: 0.39, marginX: 0.03, marginY: 0.03 }),
  { width: '39%', bottom: '3%', left: '50%', transform: 'translateX(-50%)' },
  'CSS watermark uses the same normalized width, margin, and anchor as export positioning',
)

console.log('media preview geometry tests passed')
