import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../electron/devices/insta360/lunaRenderCoreNormalize.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const normalization = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const currentColor = normalization.normalizeColor({})
currentColor.exposure = 42

const current = normalization.normalizeColorForNative(currentColor)
assert.equal(current.reset, false)
assert.equal(current.color.exposure, 42)

const { glowStrength: _missingGlowStrength, ...legacyColor } = currentColor
const legacy = normalization.normalizeColorForNative(legacyColor)
assert.equal(legacy.reset, true)
assert.equal(legacy.color.exposure, 0, 'incompatible color data must be reset as a whole')
assert.equal(legacy.color.glowStrength, 0)
assert.equal(legacy.color.glowRadius, 35)
assert.equal(legacy.color.glowThreshold, 65)

const cleaned = normalization.cleanNativeInputValue({
  composition: {
    layers: [{ color: legacyColor }],
  },
})
assert.equal(cleaned.composition.layers[0].color.exposure, 0)
assert.equal(cleaned.composition.layers[0].color.glowStrength, 0)

console.log('Render input color compatibility verified')
