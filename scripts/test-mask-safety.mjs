import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-mask-tests-'))

function close(actual, expected, message, epsilon = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`)
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const filePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(filePath) : [filePath]
  }))
  return nested.flat()
}

async function compileModules(entryPaths) {
  const program = ts.createProgram(entryPaths.map((entry) => path.join(projectRoot, entry)), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: temporaryRoot,
    skipLibCheck: true,
    noEmitOnError: false,
  })
  const result = program.emit()
  assert.equal(result.emitSkipped, false, 'mask test modules must compile')

  const javascriptFiles = (await walkFiles(temporaryRoot)).filter((filePath) => filePath.endsWith('.js'))
  for (const filePath of javascriptFiles) {
    const source = await readFile(filePath, 'utf8')
    let rewritten = source.replace(/(from\s+|import\s*)(['"])(\.[^'"]+)\2/g, (match, prefix, quote, specifier) => {
      const resolved = path.resolve(path.dirname(filePath), specifier)
      if (existsSync(`${resolved}.js`)) return `${prefix}${quote}${specifier}.js${quote}`
      if (existsSync(path.join(resolved, 'index.js'))) return `${prefix}${quote}${specifier}/index.js${quote}`
      return match
    })
    if (filePath.endsWith(`${path.sep}borderPresets.js`)) {
      rewritten = rewritten.replace(
        /const presetModules = import\.meta\.glob\([\s\S]*?\n\}\);/,
        'const presetModules = {};',
      )
    }
    if (rewritten !== source) await writeFile(filePath, rewritten, 'utf8')
  }
}

try {
  await compileModules([
    'electron/workspaceProjectService.ts',
    'electron/colorMaskService.ts',
    'src/workspace/shared/editPipeline.ts',
    'src/workspace/shared/editPipelineSerialization.ts',
    'src/workspace/shared/editHistory.ts',
    'src/workspace/shared/renderLayerPipeline.ts',
    'src/workspace/beauty/beautyMaskVisualization.ts',
    'src/workspace/creative/only-your-color/onlyYourColorAutoTone.ts',
    'src/workspace/creative/only-your-color/onlyYourColorLayers.ts',
    'src/workspace/creative/only-your-color/onlyYourColorBatchMask.ts',
    'src/workspace/creative/only-your-color/onlyYourColorState.ts',
    'src/workspace/creative/only-your-color/onlyYourColorMaskRefinement.ts',
    'src/workspace/creative/pixel-flow/pixelFlowBatchMask.ts',
    'src/workspace/creative/pixel-flow/pixelFlowLayers.ts',
    'src/components/renderComposition.ts',
    'src/workspace/shared/exportLayerSnapshot.ts',
    'src/workspace/mask/maskOperationIdentity.ts',
    'src/workspace/mask/maskPreviewSampling.ts',
    'src/workspace/mask/maskTrack.ts',
    'src/workspace/mask/maskSelectionOperations.ts',
    'src/workspace/mask/maskShapeRasterization.ts',
    'src/workspace/mask/maskComponentRasterization.ts',
    'src/workspace/mask/maskComponentControls.ts',
    'src/workspace/mask/maskManualRasterization.ts',
    'src/shared/segmentationModels.ts',
    'src/workspace/color/colorMaskLayerOperations.ts',
    'src/workspace/shared/workspaceProjectPipeline.ts',
  ])
  await symlink(
    path.join(projectRoot, 'node_modules'),
    path.join(temporaryRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  const projectService = await import(pathToFileURL(path.join(temporaryRoot, 'electron/workspaceProjectService.js')))
  const maskService = await import(pathToFileURL(path.join(temporaryRoot, 'electron/colorMaskService.js')))
  const pipelineModule = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/editPipeline.js')))
  const pipelineSerialization = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/editPipelineSerialization.js')))
  const historyModule = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/editHistory.js')))
  const renderModule = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/renderLayerPipeline.js')))
  const beautyLayers = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/beauty/beautyLayers.js')))
  const beautyVisualization = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/beauty/beautyMaskVisualization.js')))
  const onlyYourColorAutoTone = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/only-your-color/onlyYourColorAutoTone.js')))
  const onlyYourColorLayers = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/only-your-color/onlyYourColorLayers.js')))
  const onlyYourColorBatchMask = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/only-your-color/onlyYourColorBatchMask.js')))
  const onlyYourColorState = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/only-your-color/onlyYourColorState.js')))
  const onlyYourColorMaskRefinement = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/only-your-color/onlyYourColorMaskRefinement.js')))
  const pixelFlowBatchMask = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/pixel-flow/pixelFlowBatchMask.js')))
  const pixelFlowLayers = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/creative/pixel-flow/pixelFlowLayers.js')))
  const renderComposition = await import(pathToFileURL(path.join(temporaryRoot, 'src/components/renderComposition.js')))
  const exportSnapshot = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/exportLayerSnapshot.js')))
  const operationIdentity = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskOperationIdentity.js')))
  const previewSampling = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskPreviewSampling.js')))
  const maskTrack = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskTrack.js')))
  const selectionOperations = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskSelectionOperations.js')))
  const shapeRasterization = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskShapeRasterization.js')))
  const componentRasterization = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskComponentRasterization.js')))
  const componentControls = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskComponentControls.js')))
  const manualRasterization = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskManualRasterization.js')))
  const segmentationModels = await import(pathToFileURL(path.join(temporaryRoot, 'src/shared/segmentationModels.js')))
  const layerOperations = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/color/colorMaskLayerOperations.js')))
  const projectPipeline = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/workspaceProjectPipeline.js')))
  const { createDefaultPipeline, mergePipeline } = pipelineModule

  const maxBeautyParameters = { faceWhitening: 100, skinWhitening: 100, skinWarmth: 0, smoothing: 0, texture: 100, acneRemoval: 100, spotRemoval: 100, wrinkleReduction: 100 }
  const beautyBodyLayer = beautyLayers.createBeautyMaskLayer('body', { path: '/tmp/body.pgm', width: 1, height: 1 }, maxBeautyParameters)
  const beautyFaceLayer = beautyLayers.createBeautyMaskLayer('face', { path: '/tmp/face.pgm', width: 1, height: 1 }, maxBeautyParameters)
  const beautyAcneLayer = beautyLayers.createBeautyMaskLayer('acne', { path: '/tmp/acne.pgm', width: 1, height: 1 }, maxBeautyParameters)
  const beautySpotLayer = beautyLayers.createBeautyMaskLayer('spot', { path: '/tmp/spot.pgm', width: 1, height: 1 }, maxBeautyParameters)
  const beautyWrinkleLayer = beautyLayers.createBeautyMaskLayer('wrinkle', { path: '/tmp/wrinkle.pgm', width: 1, height: 1 }, maxBeautyParameters)
  const beautyManualLayer = beautyLayers.createManualBeautyRetouchLayer({ path: '/tmp/manual-retouch.pgm', width: 1, height: 1 })
  const beautyPipeline = { ...createDefaultPipeline(), beautyMasks: [beautyBodyLayer, beautyFaceLayer, beautySpotLayer, beautyAcneLayer, beautyWrinkleLayer] }
  close(beautyBodyLayer.color.exposure, 0.08, 'stored body brightening must remain restrained')
  close(beautyFaceLayer.color.exposure, 0.2, 'stored face brightening must remain restrained')
  const renderedBeautyBody = beautyLayers.beautyLayerColorForRendering(beautyPipeline, beautyBodyLayer)
  const renderedBeautyFace = beautyLayers.beautyLayerColorForRendering(beautyPipeline, beautyFaceLayer)
  close(renderedBeautyBody.exposure, 0.3, 'rendered body brightening maximum must remain visibly effective')
  close(renderedBeautyFace.exposure, 0.6, 'rendered face brightening must combine overall and face adjustments')
  close(renderedBeautyBody.temperature, 0, 'brightening must not neutralize the original skin tone')
  close(renderedBeautyBody.saturation, -2.5, 'brightening must retain natural skin saturation')
  close(renderedBeautyBody.curveLift, 0, 'brightening must not lift midtones and flatten facial planes')
  close(renderedBeautyBody.hslChannels.orange.saturation, -3, 'brightening must only gently reduce orange saturation')
  close(renderedBeautyBody.hslChannels.orange.luminance, 1.5, 'brightening must only gently lift orange skin luminance')
  close(renderedBeautyFace.hslChannels.yellow.saturation, -7, 'face brightening must retain yellow skin detail')
  close(renderedBeautyFace.texture, 35, 'beauty texture must restore detail at a controlled strength')
  const smoothingParameters = { ...maxBeautyParameters, smoothing: 100, texture: 0 }
  const smoothingFaceLayer = beautyLayers.createBeautyMaskLayer('face', { path: '/tmp/smoothing-face.pgm', width: 1, height: 1 }, smoothingParameters)
  const renderedSmoothingFace = beautyLayers.beautyLayerColorForRendering(
    { ...createDefaultPipeline(), beautyMasks: [smoothingFaceLayer] },
    smoothingFaceLayer,
  )
  close(renderedSmoothingFace.denoise, 0, 'beauty smoothing must not enter the generic blur branch')
  close(
    beautyLayers.beautySkinSmoothingForRendering(
      { ...createDefaultPipeline(), beautyMasks: [smoothingFaceLayer] },
      smoothingFaceLayer,
    ),
    100,
    'beauty smoothing must preserve the full slider range in its dedicated render parameter',
  )
  const mediumSmoothingParameters = { ...smoothingParameters, smoothing: 50 }
  const mediumSmoothingFaceLayer = beautyLayers.createBeautyMaskLayer('face', { path: '/tmp/medium-smoothing-face.pgm', width: 1, height: 1 }, mediumSmoothingParameters)
  const renderedMediumSmoothingFace = beautyLayers.beautyLayerColorForRendering(
    { ...createDefaultPipeline(), beautyMasks: [mediumSmoothingFaceLayer] },
    mediumSmoothingFaceLayer,
  )
  close(renderedMediumSmoothingFace.denoise, 0, 'medium beauty smoothing must not enter the generic blur branch')
  close(
    beautyLayers.beautySkinSmoothingForRendering(
      { ...createDefaultPipeline(), beautyMasks: [mediumSmoothingFaceLayer] },
      mediumSmoothingFaceLayer,
    ),
    50,
    'beauty smoothing must use the slider value in its dedicated render parameter',
  )
  const renderedBeautyAcne = beautyLayers.beautyLayerColorForRendering(beautyPipeline, beautyAcneLayer)
  const renderedBeautySpot = beautyLayers.beautyLayerColorForRendering(beautyPipeline, beautySpotLayer)
  const renderedBeautyManual = beautyLayers.beautyLayerColorForRendering(
    { ...beautyPipeline, beautyMasks: [beautyManualLayer, ...beautyPipeline.beautyMasks] },
    beautyManualLayer,
  )
  close(renderedBeautyAcne.denoise, 1300, 'acne removal must use localized repair blur instead of edge-protected smoothing')
  close(renderedBeautySpot.denoise, 1900, 'spot removal must use a wider localized repair sample')
  close(renderedBeautyManual.denoise, 1900, 'manual retouch strokes must use localized skin repair')
  close(beautyLayers.beautyLayerOpacityForRendering(beautyPipeline, beautyAcneLayer), 0, 'retired acne repair must not render')
  close(beautyLayers.beautyLayerOpacityForRendering(beautyPipeline, beautySpotLayer), 0, 'retired spot repair must not render')
  close(beautyLayers.beautyLayerOpacityForRendering(beautyPipeline, beautyWrinkleLayer), 0, 'retired wrinkle repair must not render')
  const faceOnlyParameters = { ...maxBeautyParameters, skinWhitening: 0, smoothing: 0, texture: 0 }
  const bodyOnlyParameters = { ...maxBeautyParameters, faceWhitening: 0, smoothing: 0, texture: 0 }
  const faceOnlyLayer = beautyLayers.createBeautyMaskLayer('face', { path: '/tmp/face-only.pgm', width: 1, height: 1 }, faceOnlyParameters)
  const faceOnlyBodyLayer = beautyLayers.createBeautyMaskLayer('body', { path: '/tmp/face-only-body.pgm', width: 1, height: 1 }, faceOnlyParameters)
  const bodyOnlyFaceLayer = beautyLayers.createBeautyMaskLayer('face', { path: '/tmp/body-only-face.pgm', width: 1, height: 1 }, bodyOnlyParameters)
  const bodyOnlyLayer = beautyLayers.createBeautyMaskLayer('body', { path: '/tmp/body-only.pgm', width: 1, height: 1 }, bodyOnlyParameters)
  const renderedFaceOnly = beautyLayers.beautyLayerColorForRendering(
    { ...createDefaultPipeline(), beautyMasks: [faceOnlyBodyLayer, faceOnlyLayer] },
    faceOnlyLayer,
  )
  const renderedBodyOnly = beautyLayers.beautyLayerColorForRendering(
    { ...createDefaultPipeline(), beautyMasks: [bodyOnlyLayer, bodyOnlyFaceLayer] },
    bodyOnlyLayer,
  )
  assert.deepEqual(renderedFaceOnly, renderedBodyOnly, 'equal face and overall whitening strengths must use the same rendering algorithm')
  assert.deepEqual(
    beautyLayers.replaceBeautyLayers(beautyFaceLayer, beautyBodyLayer, beautyAcneLayer, beautySpotLayer, beautyWrinkleLayer).map((layer) => layer.id),
    ['beauty-wrinkles', 'beauty-acne', 'beauty-spots', 'beauty-face-skin', 'beauty-body-skin'],
    'localized beauty repairs must remain above broad face and body adjustments',
  )
  close(beautyAcneLayer.color.denoise, 100, 'acne removal strength must use local edge-aware smoothing')
  close(beautySpotLayer.color.exposure, 0.2, 'spot removal strength must use local exposure correction')
  close(beautyWrinkleLayer.color.denoise, 75, 'wrinkle reduction must preserve texture with bounded local smoothing')
  assert.deepEqual(beautyLayers.beautyClipboardSettings(beautyPipeline), { parameters: maxBeautyParameters, enabled: true })
  assert.deepEqual(beautyLayers.beautyParameters(beautyPipeline), maxBeautyParameters)
  assert.equal(beautyLayers.isBeautyAnalysisCurrent(beautyPipeline), true, 'current beauty masks must not be analyzed again')
  assert.equal(
    beautyLayers.isBeautyAnalysisCurrent({
      ...beautyPipeline,
      beautyMasks: beautyPipeline.beautyMasks.map((layer) => layer.id === 'beauty-body-skin'
        ? { ...layer, modelId: 'schp-atr-18-int8' }
        : layer),
    }),
    false,
    'legacy SCHP ResNet18 body masks must be regenerated with ResNet101',
  )
  assert.deepEqual(
    beautyVisualization.BEAUTY_MASK_VISUALIZATION.map(({ id, label, color }) => ({ id, label, color })),
    [
      { id: 'beauty-body-skin', label: '身体肌肤', color: '#35C46A' },
      { id: 'beauty-face-skin', label: '面部肌肤', color: '#21C7D9' },
    ],
    'beauty mask preview legend must only show active skin masks',
  )

  const normalizedTrack = maskTrack.normalizeMaskTrack({
    version: 1,
    anchorTime: 2,
    startTime: 99,
    endTime: 0,
    keyframes: [
      { time: 4, translateX: 0.2, translateY: -0.1, scale: 1.2, rotation: 0.4, confidence: 0.6 },
      { time: 2, translateX: 0, translateY: 0, scale: 1, rotation: 0, confidence: 1, corrected: true },
    ],
  })
  assert.equal(normalizedTrack.startTime, 2, 'track range must be derived from sorted keyframes')
  assert.equal(normalizedTrack.endTime, 4)
  assert.deepEqual(normalizedTrack.keyframes.map((keyframe) => keyframe.time), [2, 4])
  const interpolatedTrack = maskTrack.maskTrackTransformAt(normalizedTrack, 3)
  close(interpolatedTrack.translateX, 0.1, 'track translation must interpolate at preview time')
  close(interpolatedTrack.translateY, -0.05, 'track translation Y must interpolate at preview time')
  close(interpolatedTrack.scale, 1.1, 'track scale must interpolate at preview time')
  close(interpolatedTrack.rotation, 0.2, 'track rotation must interpolate at preview time')
  assert.deepEqual(
    maskTrack.maskTrackTransformAt(undefined, 5),
    { time: 5, translateX: 0, translateY: 0, scale: 1, rotation: 0, confidence: 1 },
    'projects without tracking data must keep the identity mask transform',
  )
  const mergedForwardTrack = maskTrack.mergeMaskTrackSegment(normalizedTrack, 3, 'forward', [
    { time: 3, translateX: 0.1, translateY: 0, scale: 1, rotation: 0, confidence: 1 },
    { time: 5, translateX: 0.4, translateY: 0, scale: 1, rotation: 0, confidence: 0.8 },
  ])
  assert.deepEqual(mergedForwardTrack.keyframes.map((keyframe) => keyframe.time), [2, 3, 5], 'forward tracking must preserve only earlier trajectory samples')
  const mergedBackwardTrack = maskTrack.mergeMaskTrackSegment(mergedForwardTrack, 3, 'backward', [
    { time: 1, translateX: -0.2, translateY: 0, scale: 1, rotation: 0, confidence: 0.7 },
    { time: 3, translateX: 0.1, translateY: 0, scale: 1, rotation: 0, confidence: 1 },
  ])
  assert.deepEqual(mergedBackwardTrack.keyframes.map((keyframe) => keyframe.time), [1, 3, 5], 'backward tracking must preserve only later trajectory samples')

  const impulse = new Float32Array(9)
  impulse[4] = 255
  assert.deepEqual(
    [...previewSampling.featherMaskPreview(impulse, 9, 1, 0, 1, 1)],
    [...impulse],
    'zero feather must preserve preview values',
  )
  const featheredImpulse = previewSampling.featherMaskPreview(impulse, 9, 1, 2, 1, 1)
  assert.equal(featheredImpulse[4], 255, 'outward feather must preserve the original selection')
  assert.ok(featheredImpulse[3] > 0, 'outward feather must add a soft transition beyond the original edge')
  assert.ok(featheredImpulse.reduce((sum, value) => sum + value, 0) > 255, 'outward feather must expand the effective selection')
  const featheredEdge = previewSampling.featherMaskPreview(
    new Float32Array([255, 255, 0, 0, 0]),
    5,
    1,
    3,
    1,
    1,
  )
  assert.equal(featheredEdge[1], 255, 'outward feather must keep the inside of a hard edge opaque')
  assert.ok(
    featheredEdge[1] > featheredEdge[2] && featheredEdge[2] > featheredEdge[3] && featheredEdge[3] > featheredEdge[4],
    'outward feather must decay monotonically without repeated offset contours',
  )
  close(
    previewSampling.sampleMaskBilinear(new Uint8Array([0, 255]), 2, 1, 0.5, 0.5),
    127.5,
    'mask preview sampling must interpolate neighboring pixels',
  )

  const baseMask = new Uint8Array([0, 64, 128, 255])
  const incomingMask = new Uint8Array([255, 128, 64, 0])
  assert.deepEqual(
    [...selectionOperations.applyMaskSelectionOperation(baseMask, incomingMask, 'replace')],
    [...incomingMask],
    'replace must use only the incoming selection',
  )
  assert.deepEqual(
    [...selectionOperations.applyMaskSelectionOperation(baseMask, incomingMask, 'add')],
    [255, 128, 128, 255],
    'add must preserve the greater soft-mask weight',
  )
  assert.deepEqual(
    [...selectionOperations.applyMaskSelectionOperation(baseMask, incomingMask, 'subtract')],
    [0, 32, 96, 255],
    'subtract must attenuate rather than binarize soft-mask weights',
  )
  assert.deepEqual(
    [...selectionOperations.resampleMask(new Uint8Array([0, 255]), 2, 1, 4, 1)],
    [0, 64, 191, 255],
    'selection composition must resample an existing mask when model output dimensions differ',
  )
  assert.deepEqual(
    shapeRasterization.shapeBoundsFromDrag({ x: 4, y: 4 }, { x: 6, y: 5 }, { centered: true, constrained: true }),
    { left: 2, top: 2, right: 6, bottom: 6 },
    'centered constrained shapes must expand equally around their origin',
  )
  assert.deepEqual(
    [...shapeRasterization.rasterizeShapeMask(4, 4, 'rectangle', { left: 1, top: 1, right: 3, bottom: 3 })],
    [0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0],
    'rectangle selection must include the dragged pixel-center bounds',
  )
  assert.equal(
    [...shapeRasterization.rasterizeShapeMask(5, 5, 'ellipse', { left: 0, top: 0, right: 5, bottom: 5 })].filter(Boolean).length,
    21,
    'ellipse selection must exclude pixels outside its curved edge',
  )

  const linearGradient = {
    id: 'linear', type: 'linear-gradient', operation: 'replace', enabled: true, inverted: false,
    startX: 0, startY: 0.5, endX: 1, endY: 0.5,
  }
  assert.deepEqual(
    [...componentRasterization.rasterizeVectorComponent(4, 1, linearGradient)],
    [32, 96, 159, 223],
    'linear gradients must retain continuous soft-mask weights',
  )
  const rotatedRectangle = {
    id: 'rotated', type: 'rectangle', operation: 'replace', enabled: true, inverted: false,
    centerX: 0.5, centerY: 0.5, width: 0.8, height: 0.2, rotation: 90, feather: 0,
  }
  const rotatedMask = componentRasterization.rasterizeVectorComponent(5, 5, rotatedRectangle)
  assert.ok(rotatedMask[2] > rotatedMask[10], 'shape rotation must affect rasterized geometry')
  const landscapeEllipse = {
    ...rotatedRectangle,
    type: 'ellipse',
    width: 0.4,
    height: 0.2,
    rotation: 0,
  }
  const occupiedSize = (data, width, height) => {
    const points = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[y * width + x] > 0) points.push({ x, y })
      }
    }
    return {
      width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) + 1,
      height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) + 1,
    }
  }
  const landscapeHorizontalSize = occupiedSize(componentRasterization.rasterizeVectorComponent(200, 100, landscapeEllipse), 200, 100)
  const landscapeVerticalSize = occupiedSize(componentRasterization.rasterizeVectorComponent(200, 100, { ...landscapeEllipse, rotation: 90 }), 200, 100)
  assert.ok(Math.abs(landscapeHorizontalSize.width - landscapeVerticalSize.height) <= 1, 'rotating an ellipse must preserve its physical long-axis length')
  assert.ok(Math.abs(landscapeHorizontalSize.height - landscapeVerticalSize.width) <= 1, 'rotating an ellipse must preserve its physical short-axis length')
  const squareCacheHorizontalSize = occupiedSize(componentRasterization.rasterizeVectorComponent(100, 100, { ...landscapeEllipse, sourceAspect: 2 }), 100, 100)
  const squareCacheVerticalSize = occupiedSize(componentRasterization.rasterizeVectorComponent(100, 100, { ...landscapeEllipse, sourceAspect: 2, rotation: 90 }), 100, 100)
  assert.ok(Math.abs(squareCacheHorizontalSize.width * 2 - squareCacheVerticalSize.height) <= 2, 'a square mask cache must preserve the long axis for a landscape source')
  assert.ok(Math.abs(squareCacheHorizontalSize.height - squareCacheVerticalSize.width * 2) <= 2, 'a square mask cache must preserve the short axis for a landscape source')
  const powerWindow = { ...rotatedRectangle, type: 'ellipse', width: 0.4, height: 0.4, rotation: 0, feather: 0, softness: 0.5 }
  const featheredShape = componentRasterization.rasterizeVectorComponent(101, 101, powerWindow)
  const centerRow = 50 * 101
  assert.ok(featheredShape[centerRow + 50] >= 254, 'the region inside the inner softness outline must remain effectively fully selected')
  assert.ok(featheredShape[centerRow + 70] >= 120 && featheredShape[centerRow + 70] <= 136, 'the center power-window outline must represent approximately 50% mask weight')
  assert.ok(featheredShape[centerRow + 80] > featheredShape[centerRow + 81] && featheredShape[centerRow + 81] > 0, 'the practical outer outline must not introduce a hard zero boundary')
  assert.equal(featheredShape[centerRow + 84], 0, 'the continuous softness tail must eventually fall below the stored mask precision')
  assert.ok(
    featheredShape[centerRow + 60] > featheredShape[centerRow + 70]
      && featheredShape[centerRow + 70] > featheredShape[centerRow + 80],
    'power-window softness must decay smoothly on both sides of the center outline',
  )
  const invertedGradient = componentRasterization.rasterizeVectorComponent(4, 1, { ...linearGradient, inverted: true })
  assert.deepEqual([...invertedGradient], [223, 159, 96, 32], 'component inversion must invert soft weights')
  const composed = componentRasterization.composeMaskComponents(2, 1, [
    { id: 'base', type: 'raster', operation: 'replace', enabled: true, inverted: false, path: '/base.pgm', width: 2, height: 1 },
    { id: 'cut', type: 'raster', operation: 'subtract', enabled: true, inverted: false, path: '/cut.pgm', width: 2, height: 1 },
  ], (component) => component.id === 'base' ? new Uint8Array([255, 128]) : new Uint8Array([128, 255]))
  assert.deepEqual([...composed], [127, 0], 'component composition must apply ordered soft subtraction')
  const scopedGradient = componentRasterization.composeMaskComponents(2, 1, [
    { id: 'target', type: 'raster', operation: 'replace', enabled: true, inverted: false, path: '/target.pgm', width: 2, height: 1 },
    { id: 'other', type: 'raster', operation: 'add', enabled: true, inverted: false, path: '/other.pgm', width: 2, height: 1 },
    { ...linearGradient, targetComponentId: 'target', operation: 'intersect' },
  ], (component) => component.id === 'target' ? new Uint8Array([255, 255]) : new Uint8Array([0, 255]))
  assert.deepEqual([...scopedGradient], [64, 255], 'a gradient modifier must affect only its target selection component')
  const baseSelection = componentRasterization.composeBaseSelectionComponents(2, 1, [
    { id: 'target', type: 'raster', operation: 'replace', enabled: true, inverted: false, path: '/target.pgm', width: 2, height: 1 },
    { id: 'other', type: 'raster', operation: 'add', enabled: true, inverted: false, path: '/other.pgm', width: 2, height: 1 },
    { ...linearGradient, targetComponentId: 'target', operation: 'intersect' },
  ], (component) => component.id === 'target' ? new Uint8Array([255, 255]) : new Uint8Array([0, 255]))
  assert.deepEqual([...baseSelection], [255, 255], 'selection ants must follow the base AI/brush/shape selection and ignore gradient modifiers')
  const movedGradient = componentControls.updateComponentFromDrag(linearGradient, 'move', { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 })
  close(movedGradient.startX, 0.1, 'moving a gradient must translate its start handle')
  close(movedGradient.endY, 0.4, 'moving a gradient must translate its end handle')
  assert.equal(componentControls.shouldShowComponentControls('linear-gradient', true), true, 'a gradient draft must show its adjustment controls while drawing')
  assert.equal(componentControls.shouldShowComponentControls('radial-gradient', true), true, 'a radial draft must show its adjustment controls while drawing')
  assert.equal(componentControls.shouldShowComponentControls('move', false), true, 'a committed component must keep its selection frame in adjustment mode')
  assert.equal(componentControls.shouldShowComponentControls('brush', false), false, 'unrelated tools must not show stale component controls')
  const featheredWindow = { ...rotatedRectangle, type: 'ellipse', rotation: 0, feather: 0, softness: 0.25 }
  const controlHandles = componentControls.componentControlHandles(featheredWindow)
  const rotateHandles = controlHandles.filter((handle) => handle.kind === 'rotate')
  assert.equal(rotateHandles.length, 2, 'a power window must expose opposite rotation handles so one remains visible near an edge')
  close(
    (rotateHandles[0].x + rotateHandles[1].x) / 2,
    featheredWindow.centerX,
    'opposite rotation handles must remain centered horizontally',
  )
  close(
    (rotateHandles[0].y + rotateHandles[1].y) / 2,
    featheredWindow.centerY,
    'opposite rotation handles must remain centered vertically',
  )
  const featherHandles = controlHandles.filter((handle) => handle.kind === 'feather')
  assert.equal(featherHandles.length, 4, 'a power window must expose softness handles on all four sides')
  const resizeHandles = controlHandles.filter((handle) => handle.kind === 'resize')
  assert.equal(resizeHandles.length, 4, 'a power window must expose four resize handles')
  for (const handle of resizeHandles) {
    close(
      Math.hypot(
        (handle.x - featheredWindow.centerX) / (featheredWindow.width / 2),
        (handle.y - featheredWindow.centerY) / (featheredWindow.height / 2),
      ),
      1,
      'ellipse resize handles must sit directly on the center outline',
    )
  }
  assert.equal(controlHandles.some((handle) => handle.kind === 'move'), false, 'shape movement must not add an ambiguous center handle')
  const softnessOutlines = componentControls.componentSoftnessOutlines(featheredWindow)
  close(Math.max(...softnessOutlines.inner.map((point) => point.x)), featheredWindow.centerX + featheredWindow.width / 2 * 0.75, 'the inner outline must shrink from the center boundary by Soft 1')
  close(Math.max(...softnessOutlines.outer.map((point) => point.x)), featheredWindow.centerX + featheredWindow.width / 2 * 1.25, 'the outer outline must expand from the center boundary by Soft 1')
  close(Math.max(...softnessOutlines.outer.map((point) => point.y)), featheredWindow.centerY + featheredWindow.height / 2 * 1.25, 'softness outlines must preserve the ellipse aspect ratio')
  const featherHandle = featherHandles[0]
  const expandedWindow = componentControls.updateComponentFromDrag(featheredWindow, 'feather', featherHandle, {
    x: featheredWindow.centerX,
    y: featheredWindow.centerY - featheredWindow.height / 2 * 1.5,
  })
  close(expandedWindow.softness, 0.5, 'dragging any outer handle must update one uniform Soft 1 value')
  close(expandedWindow.width, featheredWindow.width, 'dragging softness must preserve the center window width')
  const resizedWindow = componentControls.updateComponentFromDrag(expandedWindow, 'resize', { x: 0, y: 0 }, {
    x: expandedWindow.centerX + expandedWindow.width / 2 / Math.SQRT2 * 0.5,
    y: expandedWindow.centerY + expandedWindow.height / 2 / Math.SQRT2 * 0.5,
  })
  close(resizedWindow.width, expandedWindow.width * 0.5, 'dragging a resize handle equally must preserve the center window aspect ratio')
  close(resizedWindow.softness, 2, 'shrinking the center window must widen softness instead of pulling the outer outline inward')
  close(resizedWindow.width * (1 + resizedWindow.softness), expandedWindow.width * (1 + expandedWindow.softness), 'shrinking the center window must preserve the absolute outer outline')
  const reshapedWindow = componentControls.updateComponentFromDrag(expandedWindow, 'resize', { x: 0, y: 0 }, {
    x: expandedWindow.centerX + expandedWindow.width / 2 / Math.SQRT2 * 0.75,
    y: expandedWindow.centerY + expandedWindow.height / 2 / Math.SQRT2 * 0.25,
  }, 2)
  close(reshapedWindow.width, expandedWindow.width * 0.75, 'horizontal resize movement must update the ellipse width independently')
  close(reshapedWindow.height, expandedWindow.height * 0.25, 'vertical resize movement must update the ellipse height independently')
  const rotatedOutline = componentControls.componentOutline({ ...landscapeEllipse, rotation: 90 }, 1, 2)
  close(
    (Math.max(...rotatedOutline.map((point) => point.x)) - Math.min(...rotatedOutline.map((point) => point.x))) * 200,
    20,
    'rotated controls must preserve the ellipse short axis in source pixels',
    0.1,
  )
  close(
    (Math.max(...rotatedOutline.map((point) => point.y)) - Math.min(...rotatedOutline.map((point) => point.y))) * 100,
    80,
    'rotated controls must preserve the ellipse long axis in source pixels',
    0.1,
  )
  const unboundedWindow = componentControls.updateComponentFromDrag(featheredWindow, 'feather', featherHandle, { x: 10.5, y: 10.5 })
  assert.ok(unboundedWindow.softness > 10, 'the outer softness range must not have an artificial size cap')
  const hardBrush = new Uint8Array(25)
  const softBrush = new Uint8Array(25)
  manualRasterization.drawMaskBrush(hardBrush, 5, 5, 2, 2, 2, 0)
  manualRasterization.drawMaskBrush(softBrush, 5, 5, 2, 2, 2, 1)
  assert.ok(hardBrush[7] > softBrush[7] && softBrush[7] > 0, 'brush feather must soften pixels inside the brush edge')

  const legacy = mergePipeline(createDefaultPipeline(), {
    colorMask: {
      path: '/project/masks/legacy.pgm',
      width: 0,
      height: 12.6,
      opacity: 2,
      inverted: true,
      feather: 999,
      kind: 'semantic',
    },
  })
  assert.equal(legacy.colorMask, null, 'legacy field must be cleared after migration')
  assert.equal(legacy.colorMasks.length, 1, 'legacy mask must migrate to one layer')
  assert.deepEqual(
    { width: legacy.colorMasks[0].width, height: legacy.colorMasks[0].height, opacity: legacy.colorMasks[0].opacity, feather: legacy.colorMasks[0].feather },
    { width: 1, height: 13, opacity: 1, feather: 100 },
    'legacy mask dimensions and effect ranges must normalize',
  )

  const invalidLayer = {
    ...legacy.colorMasks[0],
    id: '',
    name: '   ',
    blendMode: 'unknown',
    opacity: -1,
    feather: -3,
  }
  const normalized = mergePipeline(createDefaultPipeline(), { colorMasks: [invalidLayer] })
  assert.equal(normalized.colorMasks[0].name, '局部蒙版')
  assert.equal(normalized.colorMasks[0].blendMode, 'normal')
  assert.equal(normalized.colorMasks[0].opacity, 0)
  assert.equal(normalized.colorMasks[0].feather, 0)

  const normalizedComponents = mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    components: [{ ...rotatedRectangle, width: 99, height: -1, rotation: -90, feather: 2 }],
  }] }).colorMasks[0].components
  assert.equal(normalizedComponents[0].width, 99)
  assert.equal(normalizedComponents[0].height, 0.0001)
  assert.equal(normalizedComponents[0].rotation, 270)
  assert.equal(normalizedComponents[0].feather, 2)

  const migratedLegacySoftness = mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    components: [{ ...rotatedRectangle, width: 0.8, height: 0.2, feather: 0.25 }],
  }] }).colorMasks[0].components[0]
  close(migratedLegacySoftness.softness, 0.15625, 'legacy short-axis feather distances must retain their approximate ellipse coverage')

  const migratedDirectionalSoftness = mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    components: [{ ...rotatedRectangle, width: 0.8, height: 0.2, feather: 0, featherX: 0.2, featherY: 0.05 }],
  }] }).colorMasks[0].components[0]
  close(migratedDirectionalSoftness.softness, 0.5, 'legacy directional feather distances must migrate to one uniform Soft 1 value')
  assert.equal(migratedDirectionalSoftness.featherX, undefined, 'normalized projects must stop persisting obsolete directional softness')
  const reopenedSoftness = pipelineSerialization.deserializePipeline(pipelineSerialization.serializePipeline(mergePipeline(createDefaultPipeline(), {
    colorMasks: [{ ...legacy.colorMasks[0], components: [{ ...rotatedRectangle, softness: 0.75 }] }],
  }))).colorMasks[0].components[0]
  close(reopenedSoftness.softness, 0.75, 'Power Window softness must remain editable after reopening a project')
  const migratedDefaultLayerFeather = mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    feather: 2,
    components: [{ ...rotatedRectangle, softness: 0.5 }],
  }] }).colorMasks[0]
  assert.equal(migratedDefaultLayerFeather.feather, 0, 'vector component masks must not retain a second layer-level feather pass')
  const normalizedExplicitVectorFeather = mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    feather: 27,
    components: [{ ...rotatedRectangle, softness: 0.5 }],
  }] }).colorMasks[0]
  assert.equal(normalizedExplicitVectorFeather.feather, 0, 'vector component masks must use only their continuous component softness')

  const mixedModelComponents = mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    components: [
      {
        id: 'subject', type: 'raster', operation: 'replace', enabled: true, inverted: false,
        path: '/subject.pgm', width: 512, height: 512,
        dynamicSource: { kind: 'segmentation', modelId: 'rmbg-1.4', frameTime: 5.85, targetId: 'subject', classId: -1, className: '主体' },
      },
      {
        id: 'point', type: 'raster', operation: 'add', enabled: true, inverted: false,
        path: '/point.pgm', width: 512, height: 512,
        dynamicSource: { kind: 'segmentation', modelId: 'future-sam-model', frameTime: -1, point: { x: 1.2, y: -0.2 } },
      },
      {
        id: 'legacy-raster', type: 'raster', operation: 'subtract', enabled: true, inverted: false,
        path: '/manual.pgm', width: 512, height: 512,
      },
    ],
  }] }).colorMasks[0].components
  const reopenedMixedModelComponents = pipelineSerialization.deserializePipeline(pipelineSerialization.serializePipeline({
    ...createDefaultPipeline(),
    colorMasks: [{ ...legacy.colorMasks[0], componentSchemaVersion: 1, components: mixedModelComponents }],
  })).colorMasks[0].components
  assert.equal(reopenedMixedModelComponents[0].dynamicSource.modelId, 'rmbg-1.4', 'RMBG source metadata must survive project reopen')
  assert.equal(reopenedMixedModelComponents[0].dynamicSource.frameTime, 5.85, 'the exact semantic source frame must survive project reopen')
  assert.equal(reopenedMixedModelComponents[1].dynamicSource.modelId, 'future-sam-model', 'future model IDs must remain forward-compatible')
  assert.deepEqual(reopenedMixedModelComponents[1].dynamicSource.point, { x: 1, y: 0 }, 'point prompts must normalize to media coordinates')
  assert.equal(reopenedMixedModelComponents[1].dynamicSource.frameTime, 0, 'invalid negative frame times must clamp to the video start')
  assert.equal(reopenedMixedModelComponents[2].dynamicSource, undefined, 'legacy and manual raster components must remain valid without a dynamic source')

  const fiftyComponents = Array.from({ length: 50 }, (_, index) => ({
    ...rotatedRectangle,
    id: `shape-${index}`,
    operation: index === 0 ? 'replace' : index % 3 === 0 ? 'subtract' : 'add',
    centerX: (index % 10 + 0.5) / 10,
    centerY: (Math.floor(index / 10) + 0.5) / 5,
    width: 0.08,
    height: 0.12,
  }))
  const stressPipeline = mergePipeline(createDefaultPipeline(), {
    colorMasks: [{ ...legacy.colorMasks[0], components: fiftyComponents, track: normalizedTrack }],
  })
  const reopenedPipeline = pipelineSerialization.deserializePipeline(pipelineSerialization.serializePipeline(stressPipeline))
  assert.equal(reopenedPipeline.colorMasks[0].componentSchemaVersion, 1, 'advanced masks must persist an explicit component schema version')
  assert.equal(reopenedPipeline.colorMasks[0].components.length, 50, 'reopening a project must retain all 50 editable components')
  assert.deepEqual(reopenedPipeline.colorMasks[0].track, normalizedTrack, 'reopening a project must retain the video mask trajectory')
  const dualLutPipeline = mergePipeline(createDefaultPipeline(), {
    logRestore: { activeId: '/luts/LunaUltra/Luna_I-Log_to_Rec709_BT1886_s65_v2.cube' },
    lutFilter: { activeId: '/luts/film-look.cube', intensity: 42 },
  })
  const reopenedDualLut = pipelineSerialization.deserializePipeline(pipelineSerialization.serializePipeline(dualLutPipeline))
  assert.equal(reopenedDualLut.logRestore.activeId, dualLutPipeline.logRestore.activeId, 'log restoration LUT must persist independently')
  assert.equal(reopenedDualLut.lutFilter.activeId, dualLutPipeline.lutFilter.activeId, 'creative LUT must persist independently')
  const migratedLegacyLut = pipelineSerialization.deserializePipeline(JSON.stringify({
    lutFilter: { activeId: 'C:\\luts\\Luna_I-Log_to_Rec709_BT1886_s65_v2.cube', intensity: 100 },
  }))
  assert.match(migratedLegacyLut.logRestore.activeId, /Luna_I-Log_to_Rec709_BT1886_s65_v2\.cube$/)
  assert.equal(migratedLegacyLut.lutFilter.activeId, null, 'legacy restoration LUT must leave the creative filter slot')
  assert.deepEqual(
    componentRasterization.composeMaskComponents(80, 40, reopenedPipeline.colorMasks[0].components, () => null),
    componentRasterization.composeMaskComponents(80, 40, stressPipeline.colorMasks[0].components, () => null),
    'component order and output must remain stable after serialization',
  )
  const fiftyComponentStart = performance.now()
  const fiftyComponentPreview = componentRasterization.composeMaskComponents(1024, 683, reopenedPipeline.colorMasks[0].components, () => null)
  const fiftyComponentDuration = performance.now() - fiftyComponentStart
  assert.equal(fiftyComponentPreview.length, 1024 * 683)
  assert.ok(fiftyComponentDuration < 2000, `50-component preview recomposition took ${fiftyComponentDuration.toFixed(1)} ms`)

  const largeImageStart = performance.now()
  const largeImageMask = componentRasterization.rasterizeVectorComponent(6000, 4000, {
    ...rotatedRectangle,
    id: 'large-image-gradient',
    type: 'linear-gradient',
    startX: 0.1,
    startY: 0.2,
    endX: 0.9,
    endY: 0.8,
  })
  const largeImageDuration = performance.now() - largeImageStart
  assert.equal(largeImageMask.length, 24_000_000)
  assert.ok(largeImageMask[0] < largeImageMask.at(-1), '24 MP gradient must retain its direction')
  assert.ok(largeImageDuration < 2000, `24 MP component rasterization took ${largeImageDuration.toFixed(1)} ms`)
  console.log(`mask component performance: 50 components ${fiftyComponentDuration.toFixed(1)} ms; 24 MP ${largeImageDuration.toFixed(1)} ms`)
  const withUnknownComponent = pipelineSerialization.deserializePipeline(JSON.stringify({
    ...stressPipeline,
    colorMasks: [{ ...stressPipeline.colorMasks[0], components: [...fiftyComponents, { id: 'future', type: 'future-tool' }] }],
  }))
  assert.equal(withUnknownComponent.colorMasks[0].components.length, 50, 'unknown future components must be ignored without disabling the mask')
  const damagedComponent = mergePipeline(createDefaultPipeline(), {
    colorMasks: [{ ...legacy.colorMasks[0], components: [{ ...rotatedRectangle, loadError: 'missing-or-damaged', enabled: true }] }],
  }).colorMasks[0].components[0]
  assert.equal(damagedComponent.enabled, false, 'a damaged component must be isolated without disabling its whole mask layer')
  assert.equal(damagedComponent.loadError, 'missing-or-damaged')

  const featherLimit = mergePipeline(createDefaultPipeline(), {
    colorMasks: [{ ...legacy.colorMasks[0], feather: 100 }],
  })
  assert.equal(featherLimit.colorMasks[0].feather, 100, 'the UI, persisted pipeline, and renderer must all accept 100 px feathering')

  const unavailable = mergePipeline(createDefaultPipeline(), {
    colorMasks: [{ ...legacy.colorMasks[0], enabled: true, loadError: 'missing-or-damaged' }],
  })
  assert.equal(unavailable.colorMasks[0].enabled, false, 'unavailable masks must normalize to a disabled layer')
  assert.equal(unavailable.colorMasks[0].loadError, 'missing-or-damaged')

  const globalColor = createDefaultPipeline().color
  globalColor.exposure = 0.75
  globalColor.levelsBlack = 0.1
  globalColor.hslChannels.red.saturation = 8
  const localColor = createDefaultPipeline().color
  localColor.exposure = -0.25
  localColor.levelsBlack = 0.05
  localColor.hslChannels.red.saturation = 12
  localColor.gradeShadowsHue = 80
  localColor.gradeShadowsAmount = 10
  const combined = renderModule.pipelineColorWithLocalAdjustments(globalColor, localColor)
  assert.equal(combined.exposure, 0.5, 'local exposure must add to global exposure')
  close(combined.levelsBlack, 0.15, 'local black level must add to global level')
  assert.equal(combined.hslChannels[0].saturation, 20, 'local HSL must add to the matching global channel')
  assert.equal(combined.gradeShadowsHue, 80, 'active local grading hue must override global hue')
  globalColor.temperature = 14
  localColor.temperature = -4
  globalColor.curve.points.rgb = [{ x: 0.4, y: 0.5 }]
  localColor.curve.points.red = [{ x: 0.6, y: 0.7 }]
  const fullParameterSet = renderModule.pipelineColorWithLocalAdjustments(globalColor, localColor)
  assert.equal(fullParameterSet.temperature, 10, 'local temperature must add to global temperature')
  assert.deepEqual(fullParameterSet.curve.rgb, globalColor.curve.points.rgb, 'an untouched local curve must retain the global curve')
  assert.deepEqual(fullParameterSet.curve.red, localColor.curve.points.red, 'an edited local curve must override the same global channel')

  const snapshotSource = [{
    filePath: '/image.jpg', dstX: 0, dstY: 0, dstW: 1, dstH: 1,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0,
    color: { exposure: 0.5 }, transform: { orientation: 90, rotate: 0, flipH: false, flipV: false, scale: 1 },
  }]
  const renderSnapshot = exportSnapshot.snapshotPreviewLayers(snapshotSource)
  snapshotSource[0].color.exposure = 2
  snapshotSource[0].transform.flipH = true
  assert.equal(renderSnapshot[0].color.exposure, 0.5, 'queued export color must be an immutable snapshot')
  assert.equal(renderSnapshot[0].transform.flipH, false, 'queued export transform must be an immutable snapshot')

  const initial = createDefaultPipeline()
  let history = historyModule.createEditHistory(initial)
  const changed = mergePipeline(initial, { color: { exposure: 1 } })
  history = historyModule.pushHistory(history, changed)
  changed.color.exposure = 2
  assert.equal(history.present.color.exposure, 1, 'history must clone committed state')
  history = historyModule.undoHistory(history)
  assert.equal(history.present.color.exposure, 0)
  history = historyModule.redoHistory(history)
  assert.equal(history.present.color.exposure, 1)
  let groupedHistory = historyModule.createEditHistory(initial)
  for (let value = 1; value <= 30; value += 1) {
    groupedHistory = historyModule.pushHistory(
      groupedHistory,
      mergePipeline(groupedHistory.present, { color: { exposure: value / 30 } }),
      { key: 'mask:layer-a:opacity' },
    )
  }
  groupedHistory = historyModule.pushHistory(
    groupedHistory,
    mergePipeline(groupedHistory.present, { color: { exposure: 1 } }),
    { key: 'mask:layer-a:opacity', finalize: true },
  )
  assert.equal(groupedHistory.past.length, 1, 'one continuous slider gesture must create one undo state')
  assert.equal(groupedHistory.activeGroup, null, 'finalizing a gesture must close its history group')
  groupedHistory = historyModule.undoHistory(groupedHistory)
  assert.equal(groupedHistory.present.color.exposure, 0, 'one undo must revert the whole slider gesture')
  for (let index = 0; index < 65; index += 1) {
    history = historyModule.pushHistory(history, mergePipeline(history.present, { color: { exposure: index / 100 } }))
  }
  assert.equal(history.past.length, 60, 'history must retain at most 60 undo states')
  const componentHistory = historyModule.createEditHistory(mergePipeline(createDefaultPipeline(), { colorMasks: [{
    ...legacy.colorMasks[0],
    path: '/cache.pgm',
    components: [{ id: 'source', type: 'raster', operation: 'replace', enabled: true, inverted: false, path: '/source.pgm', width: 2, height: 2 }],
  }] }))
  assert.deepEqual(new Set(historyModule.collectHistoryMaskPaths(componentHistory)), new Set(['/cache.pgm', '/source.pgm']), 'history cleanup roots must retain component raster sources')

  const ordered = createDefaultPipeline()
  ordered.colorMasks = [
    { ...legacy.colorMasks[0], id: 'top', name: 'Top', enabled: true, path: '/top.pgm', blendMode: 'screen' },
    { ...legacy.colorMasks[0], id: 'hidden', name: 'Hidden', enabled: false, path: '/hidden.pgm', blendMode: 'normal' },
    { ...legacy.colorMasks[0], id: 'bottom', name: 'Bottom', enabled: true, path: '/bottom.pgm', blendMode: 'multiply' },
  ]
  const baseLayer = { filePath: '/image.jpg', dstX: 0, dstY: 0, dstW: 100, dstH: 100 }
  const layers = renderModule.buildLocalColorLayers(baseLayer, ordered)
  assert.deepEqual(layers.map((layer) => layer.maskPath), ['/bottom.pgm', '/top.pgm'], 'the visual top layer must render last')
  assert.deepEqual(layers.map((layer) => layer.blendMode), ['multiply', 'screen'])
  assert.ok(layers.every((layer) => layer.layerType === 'local-color'))
  const legacyBeauty = createDefaultPipeline()
  legacyBeauty.colorMasks = [
    {
      ...legacy.colorMasks[0],
      id: 'beauty-face-skin',
      enabled: true,
      path: '/beauty-face.pgm',
      color: { ...createDefaultPipeline().color, brightness: 5.76, denoise: 28 },
    },
    {
      ...legacy.colorMasks[0],
      id: 'beauty-body-skin',
      enabled: true,
      path: '/beauty-body.pgm',
      color: { ...createDefaultPipeline().color, brightness: 1.8 },
    },
  ]
  const migratedBeautyPipeline = mergePipeline(legacyBeauty, {})
  assert.equal(migratedBeautyPipeline.colorMasks.length, 0, 'legacy beauty masks must leave the color mask collection')
  assert.equal(migratedBeautyPipeline.beautyMasks.length, 2, 'legacy beauty masks must migrate into the beauty collection')
  const migratedBeauty = renderModule.buildLocalColorLayers(baseLayer, migratedBeautyPipeline)
  const migratedFace = migratedBeauty.find((layer) => layer.maskPath === '/beauty-face.pgm')
  const migratedBody = migratedBeauty.find((layer) => layer.maskPath === '/beauty-body.pgm')
  assert.equal(migratedFace.color.brightness, 0, 'legacy face brightening must not render as additive RGB brightness')
  assert.equal(migratedBody.color.brightness, 0, 'legacy body brightening must not render as additive RGB brightness')
  close(migratedFace.color.exposure, 0.084, 'legacy face settings must use the stronger unified brightening algorithm')
  close(migratedBody.color.exposure, 0.03, 'legacy body settings must use the stronger unified brightening algorithm')
  close(migratedFace.color.denoise, 0, 'legacy smoothing must not enter the generic blur branch')
  close(migratedFace.color.skinSmoothing, 28, 'legacy smoothing must use the dedicated skin smoothing parameter')
  assert.equal(
    renderModule.buildLocalColorLayers(baseLayer, stressPipeline)[0].maskTrack,
    undefined,
    'saved legacy trajectories must not move v1.6.0 static video masks in preview or export',
  )
  assert.deepEqual(
    renderModule.buildLocalColorLayers(baseLayer, unavailable),
    [],
    'unavailable masks must never enter preview or export layers',
  )
  const framedSource = {
    ...baseLayer,
    layerType: 'media',
    color: {
      ...renderModule.pipelineColorToRenderColor(ordered.color),
      denoise: 130,
    },
  }
  const framedLogo = { ...baseLayer, layerType: 'media', filePath: '/logo.png' }
  const framedLayers = renderModule.applyLocalColorToSourceMediaLayers(
    [framedSource, framedLogo],
    '/image.jpg',
    ordered,
  )
  assert.deepEqual(
    framedLayers.map((layer) => layer.filePath),
    ['/image.jpg', '/image.jpg', '/image.jpg', '/logo.png'],
    'frame media layers must receive local color copies without affecting other media',
  )
  assert.deepEqual(
    framedLayers.slice(1, 3).map((layer) => layer.maskPath),
    ['/bottom.pgm', '/top.pgm'],
    'frame media layers must preserve local mask ordering',
  )
  assert.equal(framedLayers[0].color.denoise, 130, 'global media adjustments must enter the precomposition once')
  assert.ok(
    framedLayers.slice(1, 3).every((layer) => layer.color.denoise !== 130),
    'local layers must not reapply global media adjustments',
  )
  assert.equal(framedLayers[3].color, undefined, 'the flattened output must not apply global color twice')
  const blurredBackground = {
    ...framedSource,
    layoutRole: 'background',
    color: {
      ...framedSource.color,
      exposure: 0,
      denoise: 3100,
    },
  }
  const framedPrecomposition = renderModule.applyLocalColorToSourceMediaLayers(
    [blurredBackground, { ...framedSource, layoutRole: 'content', zIndex: 13 }],
    '/image.jpg',
    ordered,
  )
  const precomposeInputs = framedPrecomposition.filter((layer) => layer.precomposeRole === 'input')
  const precomposeOutputs = framedPrecomposition.filter((layer) => layer.precomposeRole === 'output')
  assert.equal(precomposeInputs.length, 3, 'global color and both masks must flatten into one source texture')
  assert.equal(precomposeOutputs.length, 2, 'blurred background and clear foreground must share the flattened texture')
  assert.ok(
    framedPrecomposition.every((layer) => layer.precomposeGroup === 'framed-source-color'),
    'all framed source layers must use the same precomposition group',
  )
  assert.deepEqual(
    precomposeInputs.slice(1).map((layer) => layer.maskPath),
    ['/bottom.pgm', '/top.pgm'],
    'mask color layers must render before the frame consumes the flattened texture',
  )
  assert.equal(precomposeInputs[0].color.exposure, framedSource.color.exposure)
  assert.equal(precomposeInputs[0].color.denoise, framedSource.color.denoise)
  assert.equal(precomposeInputs[0].cornerRadius, undefined, 'frame geometry must not be baked into the source texture')
  assert.equal(precomposeOutputs[0].color.exposure, 0)
  assert.equal(precomposeOutputs[0].color.denoise, 3100, 'blur must run after mask color is flattened')
  assert.equal(precomposeOutputs[1].color, undefined, 'foreground must not apply global color a second time')
  const framedWatermark = renderModule.placeWatermarkOnFramedContent([{
    ...baseLayer,
    filePath: '/watermark.png',
    zIndex: 1,
    positioning: {
      anchor: 'bottom-right',
      targetWidth: 0.2,
      marginX: 0.03,
      marginY: 0.04,
    },
  }], [
    { ...blurredBackground, dstX: 0, dstY: 0, dstW: 1, dstH: 1, zIndex: 10 },
    { ...framedSource, isVideo: true, layoutRole: 'content', dstX: 0.1, dstY: 0.06, dstW: 0.8, dstH: 0.82, zIndex: 13 },
  ])[0]
  close(framedWatermark.positioning.targetWidth, 0.16, 'video frame watermark width must be relative to the clear content')
  close(framedWatermark.positioning.marginX, 0.124, 'video frame watermark right inset must stay inside the clear content')
  close(framedWatermark.positioning.marginY, 0.1528, 'video frame watermark bottom inset must stay inside the clear content')
  assert.equal(framedWatermark.zIndex, 14, 'video frame watermark must render above the clear content')
  const framedComposition = renderComposition.buildCompositionFromPreviewLayers(
    framedPrecomposition,
    1440,
    1080,
  )
  assert.deepEqual(
    framedComposition.layers.map((layer) => [layer.precomposeGroup, layer.precomposeRole]).sort(),
    framedPrecomposition.map((layer) => [layer.precomposeGroup, layer.precomposeRole]).sort(),
    'preview and export composition must preserve identical precomposition groups',
  )

  const existingGlobalColor = {
    ...renderModule.pipelineColorToRenderColor(ordered.color),
    exposure: 1.25,
  }
  const existingLocalColor = { ...existingGlobalColor, exposure: 2 }
  const creativeSource = {
    filePath: '/image.jpg',
    layerType: 'media',
    dstX: 0,
    dstY: 0,
    dstW: 1,
    dstH: 1,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    zIndex: 0,
    color: existingGlobalColor,
  }
  const creativeLayers = onlyYourColorLayers.buildOnlyYourColorLayers({
    layers: [creativeSource, {
      ...creativeSource,
      layerType: 'local-color',
      color: existingLocalColor,
      maskPath: '/existing-local.pgm',
      zIndex: 1,
    }],
    sourcePath: '/image.jpg',
    subjectMaskPath: '/subject.pgm',
    backgroundMaskPath: '/background.pgm',
    intensity: 100,
    subjectExposure: 0.65,
    backgroundExposure: -0.75,
    backgroundBrightness: 18,
    backgroundContrast: 24,
    subjectSaturation: 20,
    subjectVibrance: 30,
  })
  const creativeInputs = creativeLayers.filter((layer) => layer.precomposeRole === 'input')
  const creativeOutputs = creativeLayers.filter((layer) => layer.precomposeRole === 'output')
  assert.deepEqual(
    creativeInputs.map((layer) => layer.color.exposure),
    [1.25, 2],
    'only-your-color must flatten existing global and local exposure before applying its effect',
  )
  assert.equal(creativeOutputs.length, 3, 'flattened source, monochrome background, and color subject must share one precomposition')
  assert.ok(creativeOutputs.every((layer) => layer.precomposeGroup === 'only-your-color-source'))
  assert.equal(creativeOutputs[0].color, undefined, 'flattened source must not apply global color twice')
  assert.equal(creativeOutputs[1].color.exposure, -0.75, 'background exposure must be relative to the flattened existing exposure')
  assert.equal(creativeOutputs[1].color.brightness, 18)
  assert.equal(creativeOutputs[1].color.contrast, 24)
  assert.equal(creativeOutputs[2].color.exposure, 0.65, 'subject exposure must be relative to the flattened existing exposure')
  assert.equal(creativeOutputs[1].color.saturation, -100)
  assert.equal(creativeOutputs[2].color.saturation, 20)
  assert.equal(creativeOutputs[2].color.vibrance, 30)
  assert.deepEqual(
    creativeOutputs.slice(1).map((layer) => layer.maskFeather),
    [0, 0],
    'only-your-color must use one complementary soft edge instead of expanding both mask sides',
  )
  const neutralCreativeOutputs = onlyYourColorLayers.buildOnlyYourColorLayers({
    layers: [creativeSource],
    sourcePath: '/image.jpg',
    subjectMaskPath: '/subject.pgm',
    backgroundMaskPath: '/background.pgm',
    intensity: 100,
    subjectExposure: 0,
    backgroundExposure: 0,
    backgroundBrightness: 0,
    backgroundContrast: 0,
    subjectSaturation: 0,
    subjectVibrance: 0,
  }).filter((layer) => layer.precomposeRole === 'output')
  assert.equal(neutralCreativeOutputs.length, 2, 'a neutral subject must not narrow the soft edge with a duplicate source layer')

  const hardMask = new Uint8Array(15 * 9)
  for (let y = 1; y < 8; y += 1) {
    for (let x = 2; x < 13; x += 1) hardMask[y * 15 + x] = 255
  }
  const refinedMask = onlyYourColorMaskRefinement.refineOnlyYourColorMask(hardMask, 15, 9)
  const refinedRow = [...refinedMask.slice(4 * 15, 5 * 15)]
  assert.ok(refinedRow[2] > 0 && refinedRow[2] < refinedRow[3], 'refined subject edges must start with partial coverage')
  assert.ok(refinedRow[3] < refinedRow[4] && refinedRow[4] < refinedRow[5], 'refined subject edges must increase continuously')
  assert.equal(refinedRow[7], 255, 'refinement must preserve the opaque center of a large subject')
  assert.deepEqual(
    [...onlyYourColorMaskRefinement.refineOnlyYourColorMask(new Uint8Array(9), 3, 3)],
    [...new Uint8Array(9)],
    'refinement must keep an empty recognition result empty',
  )

  const darkBackgroundPixels = new Uint8ClampedArray(10 * 10 * 4)
  for (let index = 0; index < darkBackgroundPixels.length; index += 4) {
    darkBackgroundPixels[index] = 32
    darkBackgroundPixels[index + 1] = 32
    darkBackgroundPixels[index + 2] = 32
    darkBackgroundPixels[index + 3] = 255
  }
  const centerSubjectMask = new Uint8Array(10 * 10)
  for (let y = 3; y < 7; y += 1) {
    for (let x = 3; x < 7; x += 1) centerSubjectMask[y * 10 + x] = 255
  }
  const darkAutoTone = onlyYourColorAutoTone.calculateOnlyYourColorAutoTone({
    pixels: darkBackgroundPixels,
    imageWidth: 10,
    imageHeight: 10,
    mask: centerSubjectMask,
    maskWidth: 10,
    maskHeight: 10,
  })
  assert.ok(darkAutoTone.backgroundExposure > 0 && darkAutoTone.backgroundExposure <= 1.25, 'dark backgrounds must receive a bounded exposure lift')
  assert.equal(darkAutoTone.backgroundBrightness, 0, 'automatic tone must not crush shadows with negative brightness')
  assert.equal(darkAutoTone.backgroundContrast, 0, 'automatic tone must not crush shadows with fixed contrast')

  const brightBackgroundPixels = new Uint8ClampedArray(darkBackgroundPixels)
  for (let index = 0; index < brightBackgroundPixels.length; index += 4) {
    brightBackgroundPixels[index] = 160
    brightBackgroundPixels[index + 1] = 160
    brightBackgroundPixels[index + 2] = 160
  }
  for (let y = 3; y < 7; y += 1) {
    for (let x = 3; x < 7; x += 1) {
      const offset = (y * 10 + x) * 4
      brightBackgroundPixels[offset] = 0
      brightBackgroundPixels[offset + 1] = 0
      brightBackgroundPixels[offset + 2] = 0
    }
  }
  assert.deepEqual(
    onlyYourColorAutoTone.calculateOnlyYourColorAutoTone({
      pixels: brightBackgroundPixels,
      imageWidth: 10,
      imageHeight: 10,
      mask: centerSubjectMask,
      maskWidth: 10,
      maskHeight: 10,
    }),
    { backgroundExposure: 0, backgroundBrightness: 0, backgroundContrast: 0 },
    'a dark subject must not cause a balanced background to be lifted',
  )

  let batchSegmentCalls = 0
  const batchAsset = { id: 'asset-batch', name: 'batch.jpg', path: '/batch.jpg', kind: 'image' }
  const validStoredMask = new Uint8Array([
    0, 0, 0,
    0, 255, 0,
    0, 0, 0,
  ])
  const reusedBatchMask = await onlyYourColorBatchMask.resolveOnlyYourColorBatchMask({
    projectId: 'project-batch',
    asset: batchAsset,
    savedState: { intensity: 80, subjectExposure: 0.4, backgroundExposure: -1, backgroundBrightness: 12, backgroundContrast: 22, subjectSaturation: 15, subjectVibrance: 20, maskPath: '/saved.pgm', maskAssetId: batchAsset.id },
    api: {
      loadMask: async () => ({ bytes: validStoredMask.buffer, width: 3, height: 3 }),
      segment: async () => { batchSegmentCalls += 1; throw new Error('must not segment') },
      saveMask: async () => { throw new Error('must not save') },
    },
  })
  assert.equal(reusedBatchMask.newlyRecognized, false)
  assert.equal(reusedBatchMask.state.backgroundExposure, -1)
  assert.equal(reusedBatchMask.state.subjectExposure, 0.4)
  assert.equal(reusedBatchMask.state.backgroundBrightness, 12)
  assert.equal(reusedBatchMask.state.backgroundContrast, 22)
  assert.equal(batchSegmentCalls, 0, 'batch export must reuse a valid saved mask')

  const projectMaskState = {
    id: 'project-mask-state',
    name: 'Mask state',
    dir: '/workspace/workspace-projects/project-mask-state',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    assets: [],
    creative: {
      onlyYourColorByAssetId: {
        'shared-asset': {
          intensity: 80,
          maskPath: '/workspace/workspace-projects/other-project/masks/shared-asset.pgm',
          maskAssetId: 'shared-asset',
          maskProjectId: 'project-mask-state',
        },
      },
    },
  }
  const isolatedMaskState = onlyYourColorState.onlyYourColorStateForAsset(projectMaskState, 'shared-asset')
  assert.equal(isolatedMaskState?.maskPath, undefined, 'a mask from another project must not be restored')
  assert.equal(isolatedMaskState?.intensity, 80, 'invalid mask paths must not discard creative parameters')

  let batchSegmentRequest = null
  const generatedMask = new Uint8Array(25).fill(255)
  const recognizedBatchMask = await onlyYourColorBatchMask.resolveOnlyYourColorBatchMask({
    projectId: 'project-batch',
    asset: batchAsset,
    api: {
      loadMask: async () => { throw new Error('missing') },
      segment: async (request) => {
        batchSegmentRequest = request
        return { requestId: request.requestId, bytes: generatedMask.buffer, width: 5, height: 5 }
      },
      saveMask: async (_projectId, _assetId, width, height) => ({ path: '/generated.pgm', width, height }),
      calculateAutoTone: async () => ({ backgroundExposure: 0.65, backgroundBrightness: 0, backgroundContrast: 0 }),
    },
  })
  assert.equal(batchSegmentRequest.modelId, 'rmbg-1.4', 'unrecognized batch items must use the default fast subject model')
  assert.equal(recognizedBatchMask.newlyRecognized, true)
  assert.equal(recognizedBatchMask.state.intensity, 100)
  assert.equal(recognizedBatchMask.state.backgroundExposure, 0.65)
  assert.equal(recognizedBatchMask.state.subjectExposure, 0)
  assert.equal(recognizedBatchMask.state.backgroundBrightness, 0)
  assert.equal(recognizedBatchMask.state.backgroundContrast, 0)
  assert.equal(recognizedBatchMask.state.subjectSaturation, 0)
  assert.equal(recognizedBatchMask.state.subjectVibrance, 0)
  assert.equal(recognizedBatchMask.state.maskPath, '/generated.pgm')

  await assert.rejects(
    onlyYourColorBatchMask.resolveOnlyYourColorBatchMask({
      projectId: 'project-batch',
      asset: batchAsset,
      api: {
        loadMask: async () => { throw new Error('missing') },
        segment: async (request) => ({ requestId: request.requestId, bytes: new Uint8Array(25).buffer, width: 5, height: 5 }),
        saveMask: async () => { throw new Error('empty masks must not be saved') },
      },
    }),
    /未识别到主体/,
    'batch export must fail an item instead of exporting an empty segmentation mask',
  )

  const pixelFlowAsset = { id: 'pixel-video', name: 'pixel.mp4', path: '/pixel.mp4', kind: 'video' }
  let pixelFlowSegmentCalls = 0
  const reusedPixelFlowMask = await pixelFlowBatchMask.resolvePixelFlowBatchMask({
    projectId: 'project-pixel-flow',
    asset: pixelFlowAsset,
    savedState: {
      duration: 3, pixelCount: 280, lightWidth: 16, initialSaturation: 0, initialBrightness: 0,
      subjectDirection: 'down', rainSpeed: 50, rainLength: 50, flowStrength: 50,
      subjectDelay: 50, bloomStrength: 50, filterStrength: 50, colorTransition: 0.5,
      depthMaskPath: '/pixel-depth.pgm', maskAssetId: pixelFlowAsset.id,
    },
    api: {
      loadMask: async () => ({ bytes: new Uint8Array([128]).buffer, width: 1, height: 1 }),
      segment: async () => { pixelFlowSegmentCalls += 1; throw new Error('must not segment') },
      saveMask: async () => { throw new Error('must not save') },
    },
  })
  assert.equal(reusedPixelFlowMask.depthMaskPath, '/pixel-depth.pgm')
  assert.equal(reusedPixelFlowMask.newlyPrepared, false)
  assert.equal(pixelFlowSegmentCalls, 0, 'pixel flow batch export must reuse each asset\'s valid depth mask')

  const pixelFlowRequests = []
  const savedPixelFlowMasks = []
  const recognizedPixelFlowMask = await pixelFlowBatchMask.resolvePixelFlowBatchMask({
    projectId: 'project-pixel-flow',
    asset: pixelFlowAsset,
    savedState: {
      duration: 3, pixelCount: 280, lightWidth: 16, initialSaturation: 0, initialBrightness: 0,
      subjectDirection: 'down', rainSpeed: 50, rainLength: 50, flowStrength: 50,
      subjectDelay: 50, bloomStrength: 50, filterStrength: 50, colorTransition: 0.5,
      depthMaskPath: '/missing-depth.pgm', maskAssetId: pixelFlowAsset.id,
    },
    api: {
      loadMask: async () => { throw new Error('missing') },
      segment: async (request) => {
        pixelFlowRequests.push(request)
        if (request.targetId === 'sky') throw new Error('scene has no sky')
        return { requestId: request.requestId, bytes: new Uint8Array([0, 255, 0, 0]).buffer, width: 2, height: 2 }
      },
      saveMask: async (_projectId, assetId, width, height, bytes) => {
        savedPixelFlowMasks.push({ assetId, bytes: [...bytes] })
        return { path: `/${assetId}.pgm`, width, height }
      },
    },
  })
  assert.equal(recognizedPixelFlowMask.newlyPrepared, true)
  assert.equal(pixelFlowRequests.length, 2, 'missing pixel flow masks must recognize subject and sky')
  assert.ok(pixelFlowRequests.every((request) => request.frameTime === 0), 'video masks must use the first frame')
  assert.deepEqual(savedPixelFlowMasks.at(-1).bytes, [128, 224, 128, 128], 'a scene without sky must still encode subject and background regions')

  const pixelFlowSettings = {
    duration: 3, pixelCount: 280, lightWidth: 16, initialSaturation: 0, initialBrightness: 0,
    subjectDirection: 'down', rainSpeed: 50, rainLength: 50, flowStrength: 50,
    subjectDelay: 50, bloomStrength: 50, filterStrength: 50, colorTransition: 0.5,
  }
  const pixelFlowLayer = pixelFlowLayers.buildPixelFlowLayer({
    asset: pixelFlowAsset,
    maskPath: recognizedPixelFlowMask.depthMaskPath,
    playbackDuration: 6,
    pipeline: editPipeline.createDefaultPipeline(),
    settings: pixelFlowSettings,
  })
  const pixelFlowComposition = renderComposition.buildCompositionFromPreviewLayers([pixelFlowLayer], 1920, 1080, { duration: 6 })
  assert.equal(pixelFlowLayer.maskPath, recognizedPixelFlowMask.depthMaskPath)
  assert.equal(pixelFlowComposition.layers[0].maskPath, recognizedPixelFlowMask.depthMaskPath, 'pixel flow export must preserve the preview mask path')
  assert.equal(pixelFlowComposition.layers[0].pixelFlow.segmented, true, 'pixel flow export must keep segmented rendering enabled')
  const pixelFlowPipeline = editPipeline.createDefaultPipeline()
  pixelFlowPipeline.color.exposure = 0.75
  pixelFlowPipeline.lutFilter.activeId = '/filters/look.cube'
  pixelFlowPipeline.lutFilter.intensity = 64
  const adjustedPixelFlowLayer = pixelFlowLayers.buildPixelFlowLayer({
    asset: pixelFlowAsset,
    playbackDuration: 6,
    pipeline: pixelFlowPipeline,
    settings: pixelFlowSettings,
  })
  assert.equal(adjustedPixelFlowLayer.color.exposure, 0.75, 'pixel flow must inherit the source color pipeline once')
  assert.equal(adjustedPixelFlowLayer.lutId, '/filters/look.cube', 'pixel flow must reveal the selected source filter')
  assert.equal(adjustedPixelFlowLayer.lutIntensity, 64, 'pixel flow must preserve the selected filter strength')

  assert.equal(segmentationModels.modelForSegmentationRequest('subject', 'rmbg-1.4'), 'rmbg-1.4')
  assert.equal(segmentationModels.modelForSegmentationRequest('subject', 'segformer-b5-ade20k'), 'rmbg-1.4')
  assert.equal(segmentationModels.modelForSegmentationRequest(undefined, 'rmbg-1.4'), 'rmbg-1.4')
  assert.equal(segmentationModels.modelForSegmentationRequest(undefined, 'birefnet-general-lite'), 'birefnet-general-lite')
  assert.equal(segmentationModels.automaticSegmentationTarget('person'), undefined)
  assert.equal(segmentationModels.modelForSegmentationRequest('ade20k-12', 'rmbg-1.4'), 'segformer-b5-ade20k')
  assert.equal(segmentationModels.modelForSegmentationRequest(undefined, undefined), 'segformer-b5-ade20k')

  assert.equal(layerOperations.normalizeColorMaskName('  天空细节  ', '原名称'), '天空细节')
  assert.equal(layerOperations.normalizeColorMaskName('   ', '原名称'), '原名称', 'blank names must keep the original')
  assert.equal(layerOperations.normalizeColorMaskName('a'.repeat(41), '原名称').length, 40, 'mask names must not exceed 40 characters')
  assert.equal(Array.from(layerOperations.normalizeColorMaskName('蒙'.repeat(39) + '🌤️', '原名称')).length, 40, 'name truncation must not split Unicode code points')

  const reorderFixture = ordered.colorMasks
  assert.equal(
    layerOperations.reorderColorMaskLayers(reorderFixture, 'bottom', 'bottom', 'after'),
    reorderFixture,
    'dropping onto the same layer must not create a commit',
  )
  const movedAcross = layerOperations.reorderColorMaskLayers(reorderFixture, 'bottom', 'top', 'after')
  assert.deepEqual(movedAcross.map((layer) => layer.id), ['top', 'bottom', 'hidden'])
  const movedBefore = layerOperations.reorderColorMaskLayers(reorderFixture, 'top', 'bottom', 'before')
  assert.deepEqual(movedBefore.map((layer) => layer.id), ['hidden', 'top', 'bottom'])
  assert.equal(layerOperations.moveColorMaskLayer(reorderFixture, 'top', -1), reorderFixture, 'the first layer cannot move up')
  assert.equal(layerOperations.moveColorMaskLayer(reorderFixture, 'bottom', 1), reorderFixture, 'the last layer cannot move down')
  assert.deepEqual(
    layerOperations.moveColorMaskLayer(reorderFixture, 'hidden', -1).map((layer) => layer.id),
    ['hidden', 'top', 'bottom'],
  )

  const completedLayer = {
    ...reorderFixture[1],
    path: '/new-mask.pgm',
    width: 512,
    height: 512,
    name: 'stale name',
    feather: 2,
    color: createDefaultPipeline().color,
  }
  const editedWhileBusy = [
    reorderFixture[2],
    { ...reorderFixture[1], name: '最新名称', feather: 27, color: { ...reorderFixture[1].color, exposure: 0.8 } },
    reorderFixture[0],
  ]
  const mergedCompletion = layerOperations.mergeCompletedColorMaskLayer(editedWhileBusy, 'hidden', completedLayer)
  assert.deepEqual(mergedCompletion.map((layer) => layer.id), ['bottom', 'hidden', 'top'], 'completion must preserve the latest layer order')
  assert.equal(mergedCompletion[1].name, '最新名称', 'completion must preserve a rename made while busy')
  assert.equal(mergedCompletion[1].feather, 27, 'completion must preserve edge settings changed while busy')
  assert.equal(mergedCompletion[1].color.exposure, 0.8, 'completion must preserve local color changed while busy')
  assert.equal(mergedCompletion[1].path, '/new-mask.pgm', 'completion must apply the newly saved mask file')
  const repairedLayer = layerOperations.mergeCompletedColorMaskLayer(
    [{ ...reorderFixture[1], enabled: false, loadError: 'missing-or-damaged' }],
    'hidden',
    completedLayer,
  )
  assert.equal(repairedLayer[0].enabled, true, 'repairing an unavailable mask must make the layer visible again')
  assert.equal(repairedLayer[0].loadError, undefined, 'repairing an unavailable mask must clear its error state')
  const deletedWhileBusy = editedWhileBusy.filter((layer) => layer.id !== 'hidden')
  assert.equal(
    layerOperations.mergeCompletedColorMaskLayer(deletedWhileBusy, 'hidden', completedLayer),
    deletedWhileBusy,
    'completion must not recreate a layer deleted while busy',
  )

  let reorderHistory = historyModule.createEditHistory(ordered)
  reorderHistory = historyModule.pushHistory(reorderHistory, { ...ordered, colorMasks: movedAcross })
  assert.deepEqual(reorderHistory.present.colorMasks.map((layer) => layer.id), ['top', 'bottom', 'hidden'])
  reorderHistory = historyModule.undoHistory(reorderHistory)
  assert.deepEqual(reorderHistory.present.colorMasks.map((layer) => layer.id), ['top', 'hidden', 'bottom'])
  reorderHistory = historyModule.redoHistory(reorderHistory)
  assert.deepEqual(reorderHistory.present.colorMasks.map((layer) => layer.id), ['top', 'bottom', 'hidden'])

  const systemUpdatedHistory = historyModule.mapHistoryPipelines(reorderHistory, (pipeline) => ({
    ...pipeline,
    colorMasks: pipeline.colorMasks.map((layer) => layer.id === 'hidden'
      ? { ...layer, enabled: false, loadError: 'missing-or-damaged' }
      : layer),
  }))
  assert.equal(systemUpdatedHistory.past.length, reorderHistory.past.length, 'system repair must not add an undo state')
  for (const pipeline of [...systemUpdatedHistory.past, systemUpdatedHistory.present, ...systemUpdatedHistory.future]) {
    const layer = pipeline.colorMasks.find((item) => item.id === 'hidden')
    if (layer) assert.equal(layer.enabled, false, 'system repair must update every reachable history snapshot')
  }

  const firstOperation = operationIdentity.createMaskOperation(0, 'segmentation', 'project-a', 'asset-a', 'request-a')
  assert.equal(operationIdentity.isMatchingSegmentationRequest(firstOperation, 'request-a'), true)
  assert.equal(operationIdentity.isMatchingSegmentationRequest(firstOperation, 'request-b'), false, 'progress from another request must be ignored')
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-a', active: true }),
    true,
    'the active operation must match its original project and asset',
  )
  const nextOperation = operationIdentity.createMaskOperation(firstOperation.generation, 'load', 'project-a', 'asset-a')
  assert.equal(operationIdentity.isMatchingSegmentationRequest(nextOperation, 'request-a'), false, 'non-segmentation work must ignore progress')
  assert.equal(
    operationIdentity.isMatchingMaskOperation(nextOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-a', active: true }),
    false,
    'a newer generation must invalidate an older async result',
  )
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-b', active: true }),
    false,
    'switching assets must invalidate an older async result',
  )
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-b', assetId: 'asset-a', active: true }),
    false,
    'switching projects must invalidate an older async result',
  )
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-a', active: false }),
    false,
    'leaving the editing workspace must invalidate an older async result',
  )

  const projectDataRoot = path.join(temporaryRoot, 'project-data')
  const project = await projectService.createWorkspaceProject(projectDataRoot, 'Mask Safety', [])
  const firstSave = { ...project, name: 'First save' }
  const secondSave = { ...project, name: 'Second save' }
  const twoAssetProject = {
    ...project,
    assets: [
      { id: 'asset-a', name: 'A', path: '/a.jpg', kind: 'image' },
      { id: 'asset-b', name: 'B', path: '/b.jpg', kind: 'image' },
    ],
  }
  const pipelineA = createDefaultPipeline()
  pipelineA.colorMasks = [{ ...legacy.colorMasks[0], id: 'a-mask', path: '/a-mask.pgm' }]
  const pipelineB = mergePipeline(createDefaultPipeline(), { color: { exposure: 0.5 } })
  const withAEdit = projectPipeline.updateProjectAssetPipeline(twoAssetProject, 0, pipelineA)
  const withBothEdits = projectPipeline.updateProjectAssetPipeline(withAEdit, 1, pipelineB)
  assert.equal(withBothEdits.assets[0].pipeline.colorMasks[0].path, '/a-mask.pgm', 'switching to B must preserve A edits in memory')
  assert.equal(withBothEdits.assets[1].pipeline.color.exposure, 0.5, 'B must receive only its own pipeline')
  await Promise.all([
    projectService.saveWorkspaceProject(projectDataRoot, firstSave),
    projectService.saveWorkspaceProject(projectDataRoot, secondSave),
  ])
  const projectFile = path.join(project.dir, 'project.json')
  const savedProject = JSON.parse(await readFile(projectFile, 'utf8'))
  assert.equal(savedProject.name, 'Second save', 'same-project saves must finish in invocation order')

  await assert.rejects(
    projectService.saveWorkspaceProject(projectDataRoot, { ...project, id: '../escape' }),
    /项目标识无效/,
    'project ids must not escape the project root',
  )
  await assert.rejects(
    projectService.saveWorkspaceProject(projectDataRoot, { ...project, name: 1n }),
    /BigInt/,
    'serialization failures must reject the save',
  )
  const projectAfterFailure = JSON.parse(await readFile(projectFile, 'utf8'))
  assert.equal(projectAfterFailure.name, 'Second save', 'failed saves must preserve the previous complete project')
  const projectEntries = await readdir(project.dir)
  assert.equal(projectEntries.some((entry) => entry.endsWith('.tmp')), false, 'failed or completed saves must not leak temporary files')

  const maskBytes = new Uint8Array([0, 1, 127, 255])
  const maskInput = maskBytes.buffer.slice(maskBytes.byteOffset, maskBytes.byteOffset + maskBytes.byteLength)
  const firstMask = await maskService.saveColorMask(projectDataRoot, project.id, 'asset-a', 2, 2, maskInput, 0)
  const firstMaskSnapshot = await readFile(firstMask.path)
  const loadedMask = await maskService.loadColorMask(projectDataRoot, project.id, firstMask.path)
  assert.deepEqual(new Uint8Array(loadedMask.bytes), maskBytes, 'PGM save/load must preserve exact bytes')
  const secondMask = await maskService.saveColorMask(projectDataRoot, project.id, 'asset-a', 2, 2, maskInput, 40)
  assert.notEqual(secondMask.path, firstMask.path, 'every mask save must create an immutable version path')
  assert.deepEqual(await readFile(firstMask.path), firstMaskSnapshot, 'a later save must not mutate an older mask version')

  await assert.rejects(
    maskService.saveColorMask(projectDataRoot, project.id, 'asset-a', 0, 2, maskInput, 0),
    /尺寸无效/,
  )
  await assert.rejects(
    maskService.saveColorMask(projectDataRoot, project.id, 'asset-a', 2, 2, new Uint8Array([1]).buffer, 0),
    /数据与尺寸不匹配/,
  )
  await assert.rejects(
    maskService.saveColorMask(projectDataRoot, '.', 'asset-a', 2, 2, maskInput, 0),
    /项目标识无效/,
  )
  await assert.rejects(
    maskService.saveColorMask(projectDataRoot, '..', 'asset-a', 2, 2, maskInput, 0),
    /项目标识无效/,
  )

  const masksDirectory = path.dirname(firstMask.path)
  const crlfMaskPath = path.join(masksDirectory, 'crlf.pgm')
  await writeFile(crlfMaskPath, Buffer.concat([Buffer.from('P5\r\n2 2\r\n255\r\n', 'ascii'), Buffer.from(maskBytes)]))
  const crlfMask = await maskService.loadColorMask(projectDataRoot, project.id, crlfMaskPath)
  assert.deepEqual(new Uint8Array(crlfMask.bytes), maskBytes, 'PGM reader must accept CRLF headers')

  const outsideDirectory = path.join(temporaryRoot, 'outside')
  await mkdir(outsideDirectory, { recursive: true })
  const outsideMaskPath = path.join(outsideDirectory, 'outside.pgm')
  await writeFile(outsideMaskPath, Buffer.concat([Buffer.from('P5\n2 2\n255\n', 'ascii'), Buffer.from(maskBytes)]))
  await assert.rejects(maskService.loadColorMask(projectDataRoot, project.id, outsideMaskPath), /不属于当前项目/)
  await assert.rejects(maskService.deleteColorMask(projectDataRoot, project.id, outsideMaskPath), /不属于当前项目/)
  const symlinkMaskPath = process.platform === 'win32'
    ? path.join(masksDirectory, 'outside-link', 'outside.pgm')
    : path.join(masksDirectory, 'outside-link.pgm')
  if (process.platform === 'win32') {
    await symlink(outsideDirectory, path.dirname(symlinkMaskPath), 'junction')
  } else {
    await symlink(outsideMaskPath, symlinkMaskPath)
  }
  await assert.rejects(maskService.loadColorMask(projectDataRoot, project.id, symlinkMaskPath), /不属于当前项目/)

  const damagedMaskPath = path.join(masksDirectory, 'damaged.pgm')
  await writeFile(damagedMaskPath, Buffer.from('P5\n2 2\n255\n\x00', 'binary'))
  await assert.rejects(maskService.loadColorMask(projectDataRoot, project.id, damagedMaskPath), /数据不完整/)

  const persistedProject = {
    ...secondSave,
    assets: [{
      id: 'asset-a',
      name: 'Asset A',
      path: '/fixture/image.jpg',
      kind: 'image',
      pipeline: { colorMasks: [{ path: firstMask.path }] },
    }],
  }
  await projectService.saveWorkspaceProject(projectDataRoot, persistedProject)
  const cleanup = await maskService.cleanupUnreferencedColorMasks(projectDataRoot, project.id, [secondMask.path], 0)
  assert.equal(cleanup.deleted, 2, 'cleanup must remove only unreachable regular PGM files')
  assert.equal(existsSync(firstMask.path), true, 'project.json references must survive cleanup')
  assert.equal(existsSync(secondMask.path), true, 'session history references must survive cleanup')
  assert.equal(existsSync(crlfMaskPath), false, 'unreferenced PGM files must be removed')
  assert.equal(existsSync(damagedMaskPath), false, 'unreferenced damaged PGM files must be removable')
  assert.equal(existsSync(symlinkMaskPath), true, 'cleanup must not follow or delete symbolic links')

  console.log('mask safety tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
