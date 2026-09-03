import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/components/htmlPreviewGeometry.ts', import.meta.url), 'utf8')
const fileUtilsSource = await readFile(new URL('../src/lib/fileUtils.ts', import.meta.url), 'utf8')
const watermarkGeometrySource = await readFile(new URL('../src/shared/watermarkGeometry.ts', import.meta.url), 'utf8')
const watermarkLibrarySource = await readFile(new URL('../src/shared/watermarkLibrary.ts', import.meta.url), 'utf8')
const rendererSelectionSource = await readFile(new URL('../src/components/previewRendererSelection.ts', import.meta.url), 'utf8')
const previewLayerTimingSource = await readFile(new URL('../src/components/previewLayerTiming.ts', import.meta.url), 'utf8')
const nativePreviewOcclusionSource = await readFile(new URL('../src/components/nativePreviewOcclusion.ts', import.meta.url), 'utf8')
const previewViewportGeometrySource = await readFile(new URL('../src/components/previewViewportGeometry.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const geometry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const fileUtilsCompiled = ts.transpileModule(fileUtilsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const fileUtils = await import(`data:text/javascript;base64,${Buffer.from(fileUtilsCompiled).toString('base64')}`)
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
const previewLayerTimingCompiled = ts.transpileModule(previewLayerTimingSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const previewLayerTiming = await import(`data:text/javascript;base64,${Buffer.from(previewLayerTimingCompiled).toString('base64')}`)
const nativePreviewOcclusionCompiled = ts.transpileModule(nativePreviewOcclusionSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const nativePreviewOcclusion = await import(`data:text/javascript;base64,${Buffer.from(nativePreviewOcclusionCompiled).toString('base64')}`)
const previewViewportGeometryCompiled = ts.transpileModule(previewViewportGeometrySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const previewViewportGeometry = await import(`data:text/javascript;base64,${Buffer.from(previewViewportGeometryCompiled).toString('base64')}`)

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`)
}

const firstZoom = previewViewportGeometry.zoomOffsetAroundPoint({ x: 0, y: 0 }, 1, 2, 200, -120)
close(firstZoom.x, -200, 'first zoom keeps the cursor anchor horizontally fixed')
close(firstZoom.y, 120, 'first zoom keeps the cursor anchor vertically fixed')
const secondZoom = previewViewportGeometry.zoomOffsetAroundPoint(firstZoom, 2, 4, 200, -120)
close(secondZoom.x, -600, 'repeated zoom keeps the same cursor anchor horizontally fixed')
close(secondZoom.y, 360, 'repeated zoom keeps the same cursor anchor vertically fixed')

const landscape = geometry.containPreviewSize({ width: 1000, height: 800 }, { width: 1920, height: 1080 })
close(landscape.width, 1000, 'landscape preview width')
close(landscape.height, 562.5, 'landscape preview height')
const portrait = geometry.containPreviewSize({ width: 1000, height: 800 }, { width: 1080, height: 1920 })
close(portrait.width, 450, 'rotated portrait preview width')
close(portrait.height, 800, 'rotated portrait preview height')

const djiOriginalUrl = 'http://192.168.2.1/v2?storage=1&path=DCIM/DJI_001/DJI_0001.MP4'
assert.equal(fileUtils.fileNameFromPath(djiOriginalUrl), 'DJI_0001.MP4', 'DJI media endpoint exposes the original file name')
assert.equal(fileUtils.extensionFromPath(djiOriginalUrl), '.mp4', 'DJI media endpoint exposes the original extension')
assert.equal(fileUtils.mediaKindFromPath(djiOriginalUrl), 'video', 'DJI original media URL is recognized as video')

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
  sizeOnCanvasWidth: 0.3,
  placement: { mode: 'preset', anchor: 'bottom-center', insetOnShortEdge: 0.059 },
}
const customLandscape = watermarkGeometry.resolveWatermarkPositioning(customSettings, 1920, 1080)
const customPortrait = watermarkGeometry.resolveWatermarkPositioning(customSettings, 1080, 1920)
const defaultWidthCustom = watermarkGeometry.resolveWatermarkPositioning({
  ...customSettings,
  sizeOnCanvasWidth: undefined,
}, 1920, 1080)
const verticalCustom = watermarkGeometry.resolveWatermarkPositioning({
  ...customSettings,
  customAsset: { filePath: '/tmp/vertical-logo.png', width: 100, height: 400 },
  imageWidth: 100,
  imageHeight: 400,
}, 1080, 1920)
const eightyPercentWide = watermarkGeometry.resolveWatermarkPositioning({
  ...customSettings,
  sizeOnCanvasWidth: 0.8,
}, 1920, 1080)
assert.equal(watermarkGeometry.usesCustomWatermark(customSettings), true)
assert.equal(watermarkGeometry.usesCustomWatermark({
  ...customSettings,
  sourceKind: 'builtin',
}), false, 'built-in watermark ignores retained custom geometry fields')
close(customLandscape.targetWidth, 0.3, 'custom landscape width uses canvas-width percentage')
close(customPortrait.targetWidth, 0.3, 'custom portrait width uses canvas-width percentage')
close(defaultWidthCustom.targetWidth, 0.23, 'custom watermark defaults to 23 percent of canvas width')
close(eightyPercentWide.targetWidth, 0.8, '80 percent size occupies 80 percent of canvas width')
close(
  verticalCustom.targetWidth,
  0.3,
  'vertical custom watermark keeps the requested width when it fits the canvas',
)
assert.equal(customLandscape.anchor, 'top-left')
close(customLandscape.marginX, (1 - customLandscape.targetWidth) / 2, 'bottom-center preset centers landscape watermark')
assert.ok(customLandscape.marginY > 0.8, 'bottom-center preset remains near the bottom')

const moved = watermarkGeometry.resolveWatermarkPositioning({
  ...customSettings,
  placement: { mode: 'free', centerX: 0.95, centerY: 0.95 },
}, 1080, 1920)
assert.ok((moved.marginX ?? 0) + moved.targetWidth <= 1, 'free watermark stays inside right edge')
assert.ok((moved.marginY ?? 0) >= 0, 'free watermark stays inside vertical bounds')
const builtinSettings = {
  ...customSettings,
  sourceKind: 'builtin',
  style: 'luna_ultra',
  customAsset: undefined,
  imagePath: '/tmp/luna.png',
}
const movedBuiltin = watermarkGeometry.resolveWatermarkPositioning({
  ...builtinSettings,
  sizeOnCanvasWidth: 0.4,
  placement: { mode: 'free', centerX: 0.22, centerY: 0.31 },
}, 1920, 1080)
const defaultPortraitBuiltin = watermarkGeometry.resolveWatermarkPositioning({
  ...builtinSettings,
  sizeOnCanvasWidth: undefined,
  placement: undefined,
}, 1080, 1920)
close(movedBuiltin.targetWidth, 0.4, 'built-in watermark uses the editable size')
close(movedBuiltin.marginX, 0.02, 'built-in watermark uses the editable horizontal position')
close(movedBuiltin.marginY, 0.31 - movedBuiltin.targetWidth * 1920 / 1080 / 4 / 2, 'built-in watermark uses the editable vertical position')
close(defaultPortraitBuiltin.targetWidth, 0.35, 'built-in portrait watermark keeps the default size')

const firstAsset = { id: 'first', filePath: '/tmp/first.png' }
const secondAsset = { id: 'second', filePath: '/tmp/second.png' }
assert.deepEqual(
  watermarkLibrary.addCustomWatermarkAsset([firstAsset, secondAsset], secondAsset).map((asset) => asset.id),
  ['second', 'first'],
  'reimporting a watermark keeps one library entry and moves it to the front',
)
assert.deepEqual(
  watermarkLibrary.addCustomWatermarkAssets([firstAsset], [secondAsset, firstAsset]).map((asset) => asset.id),
  ['second', 'first'],
  'batch importing watermarks preserves selection order and removes duplicates',
)
assert.deepEqual(
  watermarkLibrary.removeCustomWatermarkAsset([firstAsset, secondAsset], 'first').map((asset) => asset.id),
  ['second'],
  'removing a watermark only removes the selected library entry',
)
assert.equal(
  watermarkLibrary.matchesWatermarkFileName('My Logo_(白色) 01.PNG', 'my-logo 白色01'),
  true,
  'watermark search ignores case, spaces, punctuation, and symbols',
)
assert.equal(
  watermarkLibrary.matchesWatermarkFileName('Ｃａｆｅ́－品牌.webp', 'cafe 品牌'),
  true,
  'watermark search normalizes full-width characters and diacritics',
)
assert.equal(
  watermarkLibrary.matchesWatermarkFileName('ic_watermark_iac2_image_cn.png', 'ica2 cn'),
  true,
  'watermark search tolerates one adjacent transposition in a multi-term query',
)
assert.equal(
  watermarkLibrary.matchesWatermarkFileName('ic_watermark_iac2_image_en.png', 'ica2 cn'),
  false,
  'watermark search still requires short terms such as language codes to match exactly',
)
assert.equal(
  watermarkLibrary.matchesWatermarkFileName('Primary Logo.png', 'secondary'),
  false,
  'watermark search still rejects unrelated file names',
)
assert.equal(
  watermarkLibrary.matchesWatermarkFileName('Primary Logo.png', ' - ( ) '),
  true,
  'a symbols-only query behaves like an empty search',
)

const videoLayer = { filePath: '/tmp/video.mp4', isVideo: true }
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(true, [videoLayer]),
  false,
  'ordinary video preview keeps the direct frame-upload renderer',
)
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(true, [
    videoLayer,
    { filePath: '', activeStart: 1, activeEnd: 2 },
  ]),
  false,
  'timed subtitle layers keep the continuous video decoder',
)
close(
  previewLayerTiming.compositionTimeForVideoLayer({ videoTime: 4.4, videoOffset: 0 }, 5.5),
  1.1,
  'subtitle timing uses output-relative composition time',
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
  false,
  'masked video preview keeps the direct renderer that uploads mask textures',
)
assert.equal(
  rendererSelection.requiresCompositionVideoRenderer(false, [
    { filePath: '/tmp/image.jpg' },
    { filePath: '/tmp/image.jpg', layerType: 'local-color', maskPath: '/tmp/mask.pgm' },
  ]),
  false,
  'image preview remains on the existing image renderer',
)
assert.equal(
  nativePreviewOcclusion.shouldShowNativePreview(false, true, false),
  false,
  'native GPU preview hides when its preserved route becomes inactive',
)
assert.equal(
  nativePreviewOcclusion.shouldShowNativePreview(true, false, false),
  false,
  'native GPU preview hides when its canvas has no visible bounds',
)
assert.equal(
  nativePreviewOcclusion.shouldShowNativePreview(true, true, false),
  true,
  'native GPU preview returns when the workspace is active and visible',
)

console.log('media preview geometry tests passed')
