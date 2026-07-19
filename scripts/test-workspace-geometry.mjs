import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const source = await readFile(new URL('../src/workspace/transform/cropGeometry.ts', import.meta.url), 'utf8')
const pixelStretchSource = await readFile(new URL('../src/workspace/creative/pixel-stretch/pixelStretchLayers.ts', import.meta.url), 'utf8')
const pixelStretchStateSource = await readFile(new URL('../src/workspace/creative/pixel-stretch/pixelStretchState.ts', import.meta.url), 'utf8')
const pixelStretchPathSource = await readFile(new URL('../src/workspace/creative/pixel-stretch/pixelStretchPath.ts', import.meta.url), 'utf8')
const shaderSource = await readFile(new URL('../luna-render-core/src/shaders/fragment.wgsl', import.meta.url), 'utf8')
const compilerOptions = {
  module: ts.ModuleKind.ES2020,
  target: ts.ScriptTarget.ES2020,
  importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
}
const compiled = ts.transpileModule(source, { compilerOptions }).outputText
const pixelStretchCompiled = ts.transpileModule(`${pixelStretchPathSource}\n${pixelStretchSource.replace(/import \{ buildPixelStretchFlowPath, flattenPixelStretchPath \} from '.\/pixelStretchPath'\n/, '')}`, { compilerOptions }).outputText
const pixelStretchStateCompiled = ts.transpileModule(pixelStretchStateSource, { compilerOptions }).outputText
const pixelStretchPathCompiled = ts.transpileModule(pixelStretchPathSource, { compilerOptions }).outputText

const geometry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const pixelStretch = await import(`data:text/javascript;base64,${Buffer.from(pixelStretchCompiled).toString('base64')}`)
const pixelStretchState = await import(`data:text/javascript;base64,${Buffer.from(pixelStretchStateCompiled).toString('base64')}`)
const pixelStretchPath = await import(`data:text/javascript;base64,${Buffer.from(pixelStretchPathCompiled).toString('base64')}`)

function close(actual, expected, message, epsilon = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`)
}

function cropClose(actual, expected, message) {
  close(actual.x, expected.x, `${message}.x`)
  close(actual.y, expected.y, `${message}.y`)
  close(actual.w, expected.w, `${message}.w`)
  close(actual.h, expected.h, `${message}.h`)
}

const sourceAspect = 16 / 9

assert.equal(geometry.shouldSwapOrientation(0), false)
assert.equal(geometry.shouldSwapOrientation(90), true)
close(geometry.frameAspect(sourceAspect, 0), sourceAspect, 'landscape frame aspect')
close(geometry.frameAspect(sourceAspect, 90), 1 / sourceAspect, 'portrait frame aspect after orientation')

cropClose(geometry.cropForAspect(sourceAspect, 0, sourceAspect), { x: 0, y: 0, w: 1, h: 1 }, 'original landscape crop')
cropClose(geometry.cropForAspect(sourceAspect, 90, 1 / sourceAspect), { x: 0, y: 0, w: 1, h: 1 }, 'original portrait crop')
cropClose(
  geometry.maxCropInsideImage({ sourceAspect, orientation: 0, rotate: 0, aspectRatio: geometry.frameAspect(sourceAspect, 0) }),
  { x: 0, y: 0, w: 1, h: 1 },
  'default original crop fills image',
)

const squareFromLandscape = geometry.cropForAspect(sourceAspect, 0, 1)
close(squareFromLandscape.x, 0.21875, 'square landscape crop x')
close(squareFromLandscape.y, 0, 'square landscape crop y')
close(squareFromLandscape.w, 0.5625, 'square landscape crop width')
close(squareFromLandscape.h, 1, 'square landscape crop height')

const topCrop = { x: 0, y: 0, w: 1, h: 0.5 }
const topLeftSource = geometry.framePointToSourceUv({ x: topCrop.x, y: topCrop.y }, sourceAspect, 0, 0)
const bottomLeftSource = geometry.framePointToSourceUv({ x: topCrop.x, y: topCrop.y + topCrop.h }, sourceAspect, 0, 0)
close(topLeftSource.y, 0, 'top crop starts at source top')
close(bottomLeftSource.y, 0.5, 'top crop ends at source middle')

assert.equal(geometry.isCropInsideImage({ x: 0, y: 0, w: 1, h: 1 }, sourceAspect, 0, 0), true)
assert.equal(geometry.isCropInsideImage({ x: 0, y: 0, w: 1, h: 1 }, sourceAspect, 0, 35), false)

const fitted = geometry.fitCropInsideImage({ x: 0, y: 0, w: 1, h: 1 }, sourceAspect, 0, 35)
assert.equal(geometry.isCropInsideImage(fitted, sourceAspect, 0, 35), true)
assert.ok(fitted.w < 1 || fitted.h < 1, 'rotation should shrink crop box instead of requiring preview image scale')

const maxRotated = geometry.maxCropInsideImage({
  sourceAspect,
  orientation: 0,
  rotate: 30,
  aspectRatio: sourceAspect,
})
assert.equal(geometry.isCropInsideImage(maxRotated, sourceAspect, 0, 30), true)
const oversizedRotated = {
  x: maxRotated.x - maxRotated.w * 0.005,
  y: maxRotated.y - maxRotated.h * 0.005,
  w: maxRotated.w * 1.01,
  h: maxRotated.h * 1.01,
}
assert.equal(geometry.isCropInsideImage(oversizedRotated, sourceAspect, 0, 30), false, 'max rotated crop should be tight against rotated image bounds')

const restored = geometry.fitCropInsideImage({ x: 0, y: 0, w: 1, h: 1 }, sourceAspect, 0, 0)
cropClose(restored, { x: 0, y: 0, w: 1, h: 1 }, 'crop can return to full frame when rotation permits it')

const moved = geometry.moveCropInsideImage({ x: 0.2, y: 0.2, w: 0.35, h: 0.35 }, 2, 2, {
  sourceAspect,
  orientation: 0,
  rotate: 30,
})
close(moved.w, 0.35, 'moving crop never changes width')
close(moved.h, 0.35, 'moving crop never changes height')
assert.equal(geometry.isCropInsideImage(moved, sourceAspect, 0, 30), true)

const resized = geometry.resizeCropInsideImage({ x: 0.25, y: 0.25, w: 0.2, h: 0.2 }, 'br', 0.4, 0.1, {
  sourceAspect,
  orientation: 0,
  rotate: 0,
  aspectRatio: 1,
})
close(geometry.frameAspect(sourceAspect, 0) * resized.w / resized.h, 1, 'locked resize keeps square visual aspect', 0.001)
assert.equal(geometry.isCropInsideImage(resized, sourceAspect, 0, 0), true)

const rotatedPoint = geometry.framePointToSourceUv({ x: 0.25, y: 0.5 }, sourceAspect, 0, 30)
assert.ok(rotatedPoint.y > 0.5, 'CPU rotation matches shader inverse rotation direction')

const sourcePoint = { x: 0.18, y: 0.72 }
const framePoint = geometry.sourceUvToFramePoint(sourcePoint, sourceAspect, 90, -12.5)
const roundTripPoint = geometry.framePointToSourceUv(framePoint, sourceAspect, 90, -12.5)
close(roundTripPoint.x, sourcePoint.x, 'source/frame x transform round trip')
close(roundTripPoint.y, sourcePoint.y, 'source/frame y transform round trip')

const rect = geometry.containRect(1000, 1000, 16 / 9)
close(rect.width, 1000, 'contain rect width')
close(rect.height, 562.5, 'contain rect height')
close(rect.y, 218.75, 'contain rect vertical center')

assert.match(
  shaderSource,
  /radians_value\s*=\s*\(params\.orientation\s*\+\s*params\.rotate\)/,
  'WGSL must combine orientation and fine rotation before inverse source sampling',
)
assert.match(shaderSource, /centered\.x\s*\*\s*c\s*\+\s*centered\.y\s*\*\s*s/, 'WGSL x rotation must match CPU inverse transform')
assert.match(shaderSource, /-centered\.x\s*\*\s*s\s*\+\s*centered\.y\s*\*\s*c/, 'WGSL y rotation must match CPU inverse transform')
assert.match(shaderSource, /if\s*\(params\.flip_h\s*>\s*0\.5\)[\s\S]*?centered\.x\s*=\s*-centered\.x/, 'WGSL must apply horizontal flip in source space')
assert.match(shaderSource, /if\s*\(params\.flip_v\s*>\s*0\.5\)[\s\S]*?centered\.y\s*=\s*-centered\.y/, 'WGSL must apply vertical flip in source space')

const mask = new Uint8Array([
  0, 0, 0, 0,
  0, 255, 0, 0,
  0, 0, 255, 0,
])
const subjectBounds = pixelStretch.subjectBoundsFromMask(mask, 4, 3)
cropClose(subjectBounds, { x: 0.25, y: 1 / 3, w: 0.5, h: 2 / 3 }, 'pixel stretch subject bounds')
assert.equal(pixelStretch.subjectBoundsFromMask(new Uint8Array(12), 4, 3), null, 'empty mask has no subject bounds')
assert.equal(pixelStretch.subjectBoundsFromMask(mask, 3, 3), null, 'mask dimensions must match its data')

const solidMask = new Uint8Array(25).fill(255)
assert.deepEqual(
  Array.from(pixelStretch.erodeMaskOnePixel(solidMask, 5, 5)),
  [0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0],
  'one-pixel erosion contracts every mask edge by one pixel',
)
assert.equal(pixelStretch.erodeMaskOnePixel(solidMask, 4, 5).length, 0, 'erosion rejects mismatched mask dimensions')

const legacyPixelStretchState = { preset: 'left', maskAssetId: 'legacy-photo', angle: 12 }
const mappedPixelStretchState = { preset: 'right', maskAssetId: 'mapped-photo', angle: -18 }
const pixelStretchProject = {
  creative: {
    pixelStretch: legacyPixelStretchState,
    pixelStretchByAssetId: { 'mapped-photo': mappedPixelStretchState },
  },
}
assert.equal(pixelStretchState.pixelStretchStateForAsset(pixelStretchProject, 'mapped-photo'), mappedPixelStretchState, 'mapped photo restores its own creative parameters')
assert.equal(pixelStretchState.pixelStretchStateForAsset(pixelStretchProject, 'legacy-photo'), legacyPixelStretchState, 'legacy state remains available for its original photo')
assert.equal(pixelStretchState.pixelStretchStateForAsset(pixelStretchProject, 'new-photo'), undefined, 'new photo starts from creative defaults')
assert.equal(pixelStretchState.pixelStretchStateForAsset(pixelStretchProject, undefined), undefined, 'missing photo has no creative parameters')
assert.equal(pixelStretchState.normalizePixelStretchFlowShape(undefined), 'straight', 'legacy projects keep the straight effect')
assert.equal(pixelStretchState.normalizePixelStretchFlowShape('cape'), 'cape', 'saved flow shape is restored')
assert.equal(pixelStretchState.normalizePixelStretchPathPoints([{ x: 0, y: 0 }]), undefined, 'custom path requires seven points')

const baseLayer = {
  filePath: 'subject.png',
  fit: 'cover',
  dstX: 0,
  dstY: 0,
  dstW: 1,
  dstH: 1,
  srcX: 0,
  srcY: 0,
  srcW: 1,
  srcH: 1,
  opacity: 1,
  zIndex: 0,
}
const flowBounds = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }
for (const shape of ['arc', 'cape', 's-curve']) {
  const points = pixelStretchPath.buildPixelStretchFlowPath({ shape, preset: 'right', length: 70, curve: 60, aspect: 1, bounds: flowBounds })
  assert.equal(points.length, 7, `${shape} produces two connected cubic curves`)
  assert.deepEqual(points[0], { x: 0.5, y: 0.5 }, `${shape} starts at the subject center`)
  assert.equal(pixelStretchPath.flattenPixelStretchPath(points).length, 14, `${shape} packs seven render points`)
}
const customFlowPoints = Array.from({ length: 7 }, (_, index) => ({ x: index / 10, y: index / 20 }))
assert.equal(pixelStretchPath.buildPixelStretchFlowPath({ shape: 'custom', preset: 'right', length: 70, curve: 60, aspect: 1, bounds: flowBounds, customPoints: customFlowPoints }), customFlowPoints, 'custom flow keeps the edited points')
const horizontalLayers = pixelStretch.buildPixelStretchLayers({
  layers: [baseLayer],
  maskPath: 'subject.mask',
  preset: 'right',
  intensity: 100,
  angle: 24,
  samplePosition: 25,
  sampleEndPosition: 75,
  sampleRangeStart: 30,
  sampleRangeEnd: 70,
  sampleControlStartOffset: 10,
  sampleControlEndOffset: -10,
  subjectBounds,
})
assert.equal(horizontalLayers.length, 3, 'horizontal effect has background, stretch, and subject layers')
assert.equal(horizontalLayers[1].layerType, 'pixel-stretch', 'stretch layer uses the mask-driven render mode')
assert.equal(horizontalLayers[1].pixelStretch.mode, 'right', 'right preset extends toward the right')
assert.equal(horizontalLayers[1].pixelStretch.angle, 24, 'center rotation is forwarded to the renderer')
assert.equal(horizontalLayers[1].pixelStretch.ribbonSize, 40, 'sampling range is forwarded to the renderer')
close(horizontalLayers[1].pixelStretch.sampleStart, 8 / 15, 'horizontal sampling range has the expected start')
close(horizontalLayers[1].pixelStretch.sampleEnd, 4 / 5, 'horizontal sampling range has the expected end')
close(horizontalLayers[1].pixelStretch.originX, 0.375, 'horizontal sampling follows the selected subject x coordinate')
close(horizontalLayers[1].pixelStretch.lineEnd, 0.625, 'horizontal sampling line follows the independently selected bottom x coordinate')
close(horizontalLayers[1].pixelStretch.controlStart, 61 / 120, 'first pen handle controls the sampling curve')
close(horizontalLayers[1].pixelStretch.controlEnd, 59 / 120, 'second pen handle controls the sampling curve')
close(horizontalLayers[1].pixelStretch.originY, 2 / 3, 'stretch origin follows the subject center y')
close(horizontalLayers[1].pixelStretch.centerX, 0.5, 'rotation center follows the sampling endpoints center x')
close(horizontalLayers[1].pixelStretch.centerY, 2 / 3, 'rotation center follows the sampling endpoints center y')
assert.equal(horizontalLayers[2].layerType, 'local-color', 'foreground subject uses clipping mask semantics')
assert.equal(horizontalLayers[2].maskPath, 'subject.mask', 'foreground subject keeps its mask')

const shapedLayers = pixelStretch.buildPixelStretchLayers({
  layers: [baseLayer],
  maskPath: 'subject.mask',
  preset: 'right',
  angle: 0,
  samplePosition: 50,
  sampleEndPosition: 50,
  sampleRangeStart: 20,
  sampleRangeEnd: 80,
  sampleControlStartOffset: 0,
  sampleControlEndOffset: 0,
  subjectBounds,
  sourceAspect: 1,
  flowShape: 'cape',
  flowLength: 80,
  flowCurve: 70,
  flowWidth: 90,
  flowEndWidth: 30,
})
assert.equal(shapedLayers[1].pixelStretch.pathPoints.length, 14, 'flow shape forwards a two-segment path')
close(shapedLayers[1].pixelStretch.pathStartWidth, 0.36, 'flow start width follows the sampled strip and width setting')
close(shapedLayers[1].pixelStretch.pathEndWidth, 0.12, 'flow end width supports a tapered cape')

const verticalLayers = pixelStretch.buildPixelStretchLayers({
  layers: [baseLayer],
  maskPath: 'subject.mask',
  preset: 'vertical',
  intensity: 100,
  angle: 0,
  samplePosition: 75,
  sampleEndPosition: 25,
  sampleRangeStart: 0,
  sampleRangeEnd: 100,
  sampleControlStartOffset: 0,
  sampleControlEndOffset: 0,
  subjectBounds,
})
assert.equal(verticalLayers[1].pixelStretch.mode, 'vertical', 'vertical preset extends both up and down')
close(verticalLayers[1].pixelStretch.originY, 5 / 6, 'vertical sampling follows the selected subject y coordinate')
close(verticalLayers[1].pixelStretch.lineEnd, 0.5, 'vertical sampling line follows the independently selected right y coordinate')
close(verticalLayers[1].pixelStretch.sampleStart, 0.25, 'vertical sampling starts at the subject left edge')
close(verticalLayers[1].pixelStretch.sampleEnd, 0.75, 'vertical sampling ends at the subject right edge')

const offCenterLayers = pixelStretch.buildPixelStretchLayers({
  layers: [baseLayer],
  maskPath: 'subject.mask',
  preset: 'right',
  intensity: 100,
  angle: 30,
  samplePosition: 10,
  sampleEndPosition: 30,
  sampleRangeStart: 20,
  sampleRangeEnd: 60,
  sampleControlStartOffset: 0,
  sampleControlEndOffset: 0,
  subjectBounds,
})
close(offCenterLayers[1].pixelStretch.centerX, 0.35, 'rotation center x uses the two sampling endpoint x coordinates')
close(offCenterLayers[1].pixelStretch.centerY, 0.6, 'rotation center y uses the two sampling endpoint y coordinates')

for (const [preset, mode] of [['left', 'left'], ['top', 'up'], ['bottom', 'down'], ['horizontal', 'horizontal']]) {
  const layers = pixelStretch.buildPixelStretchLayers({
    layers: [baseLayer],
    maskPath: 'subject.mask',
    preset,
    intensity: 64,
    angle: 0,
    samplePosition: 50,
    sampleEndPosition: 50,
    sampleRangeStart: 0,
    sampleRangeEnd: 100,
    sampleControlStartOffset: 0,
    sampleControlEndOffset: 0,
    subjectBounds,
  })
  assert.equal(layers.length, 3, `${preset} effect uses one paper-strip layer`)
  assert.equal(layers[1].pixelStretch.mode, mode, `${preset} maps to ${mode}`)
}

console.log('workspace geometry tests passed')
