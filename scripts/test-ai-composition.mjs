import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const [sharedSource, cropSource, suggestionSource] = await Promise.all([
  readFile(new URL('../src/shared/compositionAnalysis.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/workspace/transform/cropGeometry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/workspace/transform/aiCompositionGeometry.ts', import.meta.url), 'utf8'),
])

const suggestionWithoutImports = suggestionSource
  .replace("import type { CompositionBounds } from '../../shared/compositionAnalysis'\n", '')
  .replace("import { compositionScoreForBounds } from '../../shared/compositionAnalysis'\n", '')
  .replace("import type { CropRect } from '../shared/editPipeline'\n", '')
  .replace("import { clampCrop, fitCropInsideImage, framePointToSourceUv, maxCropInsideImage, sourceUvToFramePoint, type CropConstraintOptions } from './cropGeometry'\n", '')

const compiled = ts.transpileModule(`${sharedSource}\n${cropSource}\n${suggestionWithoutImports}`, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const geometry = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const empty = geometry.boundsFromMask(new Uint8Array(16), 4, 4)
assert.equal(empty.coverage, 0)
assert.equal(empty.bounds, null)

const mask = new Uint8Array(16)
mask[5] = 255
mask[6] = 255
mask[9] = 255
mask[10] = 255
const subject = geometry.boundsFromMask(mask, 4, 4)
assert.equal(subject.coverage, 0.25)
assert.deepEqual(subject.bounds, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })

const centered = geometry.compositionScoreForBounds({ x: 1 / 3 - 0.05, y: 1 / 3 - 0.05, width: 0.1, height: 0.1 })
const corner = geometry.compositionScoreForBounds({ x: 0, y: 0, width: 0.1, height: 0.1 })
assert.ok(centered.normalized > corner.normalized, '三分法附近的主体应获得更高构图分')

const suggestion = geometry.suggestCompositionCrop(
  { x: 0.08, y: 0.2, width: 0.2, height: 0.3 },
  { sourceAspect: 4 / 3, orientation: 0, rotate: 0, aspectRatio: 1 },
  null,
)
assert.ok(suggestion)
assert.ok(suggestion.crop.x >= 0 && suggestion.crop.y >= 0)
assert.ok(suggestion.crop.x + suggestion.crop.w <= 1.0001)
assert.ok(suggestion.crop.y + suggestion.crop.h <= 1.0001)
assert.ok(suggestion.subjectBounds.x >= suggestion.crop.x - 0.01)
assert.ok(suggestion.subjectBounds.y >= suggestion.crop.y - 0.01)
assert.ok(suggestion.subjectBounds.x + suggestion.subjectBounds.width <= suggestion.crop.x + suggestion.crop.w + 0.01)
assert.ok(suggestion.subjectBounds.y + suggestion.subjectBounds.height <= suggestion.crop.y + suggestion.crop.h + 0.01)

const cropWithSubjectOutsideCurrent = geometry.compositionCropCandidates(
  { x: 0.72, y: 0.72, width: 0.1, height: 0.1 },
  { sourceAspect: 1, orientation: 0, rotate: 0, aspectRatio: null },
  { x: 0, y: 0, w: 0.2, h: 0.2 },
)
assert.ok(cropWithSubjectOutsideCurrent)
assert.equal(cropWithSubjectOutsideCurrent.currentIndex, cropWithSubjectOutsideCurrent.candidates.length - 1)
assert.deepEqual(cropWithSubjectOutsideCurrent.candidates[cropWithSubjectOutsideCurrent.currentIndex], { x: 0, y: 0, w: 0.2, h: 0.2 })

const rotated = geometry.suggestCompositionCrop(
  { x: 0.2, y: 0.15, width: 0.25, height: 0.25 },
  { sourceAspect: 16 / 9, orientation: 90, rotate: 4, aspectRatio: 4 / 5 },
  null,
)
assert.ok(rotated)
assert.ok(rotated.crop.x >= 0 && rotated.crop.y >= 0)
assert.ok(rotated.crop.x + rotated.crop.w <= 1.0001)
assert.ok(rotated.crop.y + rotated.crop.h <= 1.0001)

console.log('AI composition geometry tests passed')
