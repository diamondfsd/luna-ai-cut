import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const source = await readFile(new URL('../src/workspace/transform/cropGeometry.ts', import.meta.url), 'utf8')
const shaderSource = await readFile(new URL('../src/workspace/renderer/shaders/pipeline.glsl', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText

const geometry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

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

const restored = geometry.fitCropInsideImage({ x: 0, y: 0, w: 1, h: 1 }, sourceAspect, 0, 0)
cropClose(restored, { x: 0, y: 0, w: 1, h: 1 }, 'crop can return to full frame when rotation permits it')

const rect = geometry.containRect(1000, 1000, 16 / 9)
close(rect.width, 1000, 'contain rect width')
close(rect.height, 562.5, 'contain rect height')
close(rect.y, 218.75, 'contain rect vertical center')

assert.ok(shaderSource.includes('vec2 outputUv = vec2(uv.x, 1.0 - uv.y);'), 'shader must convert WebGL UV into top-left output space before crop')
assert.ok(!shaderSource.includes('vec2 sampleUv = vec2(uv.x, 1.0 - uv.y);'), 'shader source sampling must not flip the top-left crop space again')

console.log('workspace geometry tests passed')
