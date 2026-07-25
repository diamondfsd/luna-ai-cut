import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/components/htmlPreviewGeometry.ts', import.meta.url), 'utf8')
const watermarkGeometrySource = await readFile(new URL('../src/shared/watermarkGeometry.ts', import.meta.url), 'utf8')
const watermarkLibrarySource = await readFile(new URL('../src/shared/watermarkLibrary.ts', import.meta.url), 'utf8')
const rendererSelectionSource = await readFile(new URL('../src/components/previewRendererSelection.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const geometry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const watermarkGeometryCompiled = ts.transpileModule(watermarkGeometrySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const watermarkGeometry = await import(`data:text/javascript;base64,${Buffer.from(watermarkGeometryCompiled).toString('base64')}`)
const watermarkLibraryCompiled = ts.transpileModule(watermarkLibrarySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const watermarkLibrary = await import(`data:text/javascript;base64,${Buffer.from(watermarkLibraryCompiled).toString('base64')}`)
const rendererSelectionCompiled = ts.transpileModule(rendererSelectionSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const rendererSelection = await import(`data:text/javascript;base64,${Buffer.from(rendererSelectionCompiled).toString('base64')}`)

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

const customSettings = {
  enabled: true,
  style: 'custom',
  position: 'bottom-center',
  sourceKind: 'custom',
  customAsset: { filePath: '/tmp/logo.png', width: 400, height: 100 },
  imageWidth: 400,
  imageHeight: 100,
  sizeOnShortEdge: 0.391,
  placement: { mode: 'preset', anchor: 'bottom-center', insetOnShortEdge: 0.059 },
}
const customLandscape = watermarkGeometry.resolveWatermarkPositioning(customSettings, 1920, 1080)
const customPortrait = watermarkGeometry.resolveWatermarkPositioning(customSettings, 1080, 1920)
assert.equal(watermarkGeometry.usesCustomWatermark(customSettings), true)
assert.equal(watermarkGeometry.usesCustomWatermark({
  ...customSettings,
  sourceKind: 'builtin',
}), false, 'built-in watermark ignores retained custom geometry fields')
close(customLandscape.targetWidth, 0.2199375, 'custom landscape width preserves short-edge size')
close(customPortrait.targetWidth, 0.391, 'custom portrait width preserves short-edge size')
assert.equal(customLandscape.anchor, 'top-left')
close(customLandscape.marginX, (1 - customLandscape.targetWidth) / 2, 'bottom-center preset centers landscape watermark')
assert.ok(customLandscape.marginY > 0.8, 'bottom-center preset remains near the bottom')

const moved = watermarkGeometry.resolveWatermarkPositioning({
  ...customSettings,
  placement: { mode: 'free', centerX: 0.95, centerY: 0.95 },
}, 1080, 1920)
assert.ok((moved.marginX ?? 0) + moved.targetWidth <= 1, 'free watermark stays inside right edge')
assert.ok((moved.marginY ?? 0) >= 0, 'free watermark stays inside vertical bounds')

const firstAsset = { id: 'first', filePath: '/tmp/first.png' }
const secondAsset = { id: 'second', filePath: '/tmp/second.png' }
assert.deepEqual(
  watermarkLibrary.addCustomWatermarkAsset([firstAsset, secondAsset], secondAsset).map((asset) => asset.id),
  ['second', 'first'],
  'reimporting a watermark keeps one library entry and moves it to the front',
)
assert.deepEqual(
  watermarkLibrary.removeCustomWatermarkAsset([firstAsset, secondAsset], 'first').map((asset) => asset.id),
  ['second'],
  'removing a watermark only removes the selected library entry',
)

const videoLayer = { filePath: '/tmp/video.mp4', isVideo: true }
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(true, [videoLayer]),
  false,
  'ordinary video preview keeps the direct frame-upload renderer',
)
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(true, [videoLayer], true),
  true,
  'comparing a masked video keeps the composition renderer while effects are bypassed',
)
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(true, [
    videoLayer,
    { ...videoLayer, layerType: 'local-color', maskPath: '/tmp/mask.pgm' },
  ]),
  true,
  'masked video preview uses the composition renderer that loads linear mask textures',
)
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(false, [
    { filePath: '/tmp/image.jpg' },
    { filePath: '/tmp/image.jpg', layerType: 'local-color', maskPath: '/tmp/mask.pgm' },
  ]),
  false,
  'image preview remains on the existing image renderer',
)

console.log('media preview geometry tests passed')
