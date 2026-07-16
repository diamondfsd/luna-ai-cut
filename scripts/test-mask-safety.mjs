import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
    const rewritten = source.replace(/(from\s+|import\s*)(['"])(\.[^'"]+)\2/g, (match, prefix, quote, specifier) => {
      const resolved = path.resolve(path.dirname(filePath), specifier)
      if (existsSync(`${resolved}.js`)) return `${prefix}${quote}${specifier}.js${quote}`
      if (existsSync(path.join(resolved, 'index.js'))) return `${prefix}${quote}${specifier}/index.js${quote}`
      return match
    })
    if (rewritten !== source) await writeFile(filePath, rewritten, 'utf8')
  }
}

try {
  await compileModules([
    'electron/workspaceProjectService.ts',
    'src/workspace/shared/editPipeline.ts',
    'src/workspace/shared/editHistory.ts',
    'src/workspace/shared/renderLayerPipeline.ts',
    'src/workspace/mask/maskOperationIdentity.ts',
    'src/workspace/mask/maskModelMode.ts',
    'src/workspace/color/colorMaskLayerOperations.ts',
  ])

  const projectService = await import(pathToFileURL(path.join(temporaryRoot, 'electron/workspaceProjectService.js')))
  const pipelineModule = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/editPipeline.js')))
  const historyModule = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/editHistory.js')))
  const renderModule = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/shared/renderLayerPipeline.js')))
  const operationIdentity = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskOperationIdentity.js')))
  const modelMode = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/mask/maskModelMode.js')))
  const layerOperations = await import(pathToFileURL(path.join(temporaryRoot, 'src/workspace/color/colorMaskLayerOperations.js')))
  const { createDefaultPipeline, mergePipeline } = pipelineModule

  const legacy = mergePipeline(createDefaultPipeline(), {
    colorMask: {
      path: '/project/masks/legacy.pgm',
      width: 0,
      height: 12.6,
      opacity: 2,
      inverted: true,
      feather: 99,
      kind: 'semantic',
    },
  })
  assert.equal(legacy.colorMask, null, 'legacy field must be cleared after migration')
  assert.equal(legacy.colorMasks.length, 1, 'legacy mask must migrate to one layer')
  assert.deepEqual(
    { width: legacy.colorMasks[0].width, height: legacy.colorMasks[0].height, opacity: legacy.colorMasks[0].opacity, feather: legacy.colorMasks[0].feather },
    { width: 1, height: 13, opacity: 1, feather: 40 },
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

  const featherLimit = mergePipeline(createDefaultPipeline(), {
    colorMasks: [{ ...legacy.colorMasks[0], feather: 40 }],
  })
  assert.equal(featherLimit.colorMasks[0].feather, 40, 'the UI and persisted feather limit must both accept 40')

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
  for (let index = 0; index < 65; index += 1) {
    history = historyModule.pushHistory(history, mergePipeline(history.present, { color: { exposure: index / 100 } }))
  }
  assert.equal(history.past.length, 60, 'history must retain at most 60 undo states')

  const ordered = createDefaultPipeline()
  ordered.colorMasks = [
    { ...legacy.colorMasks[0], id: 'bottom', name: 'Bottom', enabled: true, path: '/bottom.pgm', blendMode: 'multiply' },
    { ...legacy.colorMasks[0], id: 'hidden', name: 'Hidden', enabled: false, path: '/hidden.pgm', blendMode: 'normal' },
    { ...legacy.colorMasks[0], id: 'top', name: 'Top', enabled: true, path: '/top.pgm', blendMode: 'screen' },
  ]
  const baseLayer = { filePath: '/image.jpg', dstX: 0, dstY: 0, dstW: 100, dstH: 100 }
  const layers = renderModule.buildLocalColorLayers(baseLayer, ordered)
  assert.deepEqual(layers.map((layer) => layer.maskPath), ['/top.pgm', '/bottom.pgm'], 'enabled mask layers must render in reverse stack order')
  assert.deepEqual(layers.map((layer) => layer.blendMode), ['screen', 'multiply'])
  assert.ok(layers.every((layer) => layer.layerType === 'local-color'))
  assert.deepEqual(
    renderModule.buildLocalColorLayers(baseLayer, unavailable),
    [],
    'unavailable masks must never enter preview or export layers',
  )

  const registeredModelModes = {
    'segformer-b0-ade20k': 'fast',
    'segformer-b1-ade20k': 'fast',
    'segformer-b2-ade20k': 'fine',
    'segformer-b3-ade20k': 'fine',
    'segformer-b5-ade20k': 'fine',
    'maskformer-r101-ade20k-full': 'fine',
    'slimsam-77-uniform': 'fast',
    'slimsam-50-uniform': 'fast',
    'sam-vit-b': 'fine',
  }
  for (const [modelId, expectedMode] of Object.entries(registeredModelModes)) {
    assert.equal(modelMode.productModeForModel(modelId), expectedMode, `${modelId} must map to ${expectedMode}`)
  }
  assert.equal(modelMode.modelForProductMode('fast'), 'segformer-b0-ade20k', 'normal-mode fast must run B0')
  assert.equal(modelMode.modelForProductMode('fine'), 'segformer-b2-ade20k', 'normal-mode fine must run B2')
  assert.equal(modelMode.modelForAutomaticSelection('slimsam-77-uniform'), 'segformer-b0-ade20k')
  assert.equal(modelMode.modelForAutomaticSelection('slimsam-50-uniform'), 'segformer-b0-ade20k')
  assert.equal(modelMode.modelForAutomaticSelection('sam-vit-b'), 'segformer-b2-ade20k')
  assert.equal(modelMode.modelForAutomaticSelection('segformer-b3-ade20k'), 'segformer-b3-ade20k')

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
  assert.deepEqual(movedAcross.map((layer) => layer.id), ['hidden', 'top', 'bottom'])
  const movedBefore = layerOperations.reorderColorMaskLayers(reorderFixture, 'top', 'bottom', 'before')
  assert.deepEqual(movedBefore.map((layer) => layer.id), ['top', 'bottom', 'hidden'])
  assert.equal(layerOperations.moveColorMaskLayer(reorderFixture, 'bottom', -1), reorderFixture, 'the first layer cannot move up')
  assert.equal(layerOperations.moveColorMaskLayer(reorderFixture, 'top', 1), reorderFixture, 'the last layer cannot move down')
  assert.deepEqual(
    layerOperations.moveColorMaskLayer(reorderFixture, 'hidden', -1).map((layer) => layer.id),
    ['hidden', 'bottom', 'top'],
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
  assert.deepEqual(mergedCompletion.map((layer) => layer.id), ['top', 'hidden', 'bottom'], 'completion must preserve the latest layer order')
  assert.equal(mergedCompletion[1].name, '最新名称', 'completion must preserve a rename made while busy')
  assert.equal(mergedCompletion[1].feather, 27, 'completion must preserve edge settings changed while busy')
  assert.equal(mergedCompletion[1].color.exposure, 0.8, 'completion must preserve local color changed while busy')
  assert.equal(mergedCompletion[1].path, '/new-mask.pgm', 'completion must apply the newly saved mask file')
  const deletedWhileBusy = editedWhileBusy.filter((layer) => layer.id !== 'hidden')
  assert.equal(
    layerOperations.mergeCompletedColorMaskLayer(deletedWhileBusy, 'hidden', completedLayer),
    deletedWhileBusy,
    'completion must not recreate a layer deleted while busy',
  )

  let reorderHistory = historyModule.createEditHistory(ordered)
  reorderHistory = historyModule.pushHistory(reorderHistory, { ...ordered, colorMasks: movedAcross })
  assert.deepEqual(reorderHistory.present.colorMasks.map((layer) => layer.id), ['hidden', 'top', 'bottom'])
  reorderHistory = historyModule.undoHistory(reorderHistory)
  assert.deepEqual(reorderHistory.present.colorMasks.map((layer) => layer.id), ['bottom', 'hidden', 'top'])
  reorderHistory = historyModule.redoHistory(reorderHistory)
  assert.deepEqual(reorderHistory.present.colorMasks.map((layer) => layer.id), ['hidden', 'top', 'bottom'])

  const firstOperation = operationIdentity.createMaskOperation(0, 'segmentation', 'project-a', 'asset-a')
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-a' }),
    true,
    'the active operation must match its original project and asset',
  )
  const nextOperation = operationIdentity.createMaskOperation(firstOperation.generation, 'load', 'project-a', 'asset-a')
  assert.equal(
    operationIdentity.isMatchingMaskOperation(nextOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-a' }),
    false,
    'a newer generation must invalidate an older async result',
  )
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-a', assetId: 'asset-b' }),
    false,
    'switching assets must invalidate an older async result',
  )
  assert.equal(
    operationIdentity.isMatchingMaskOperation(firstOperation, firstOperation, { projectId: 'project-b', assetId: 'asset-a' }),
    false,
    'switching projects must invalidate an older async result',
  )

  const projectDataRoot = path.join(temporaryRoot, 'project-data')
  const project = await projectService.createWorkspaceProject(projectDataRoot, 'Mask Safety', [])
  const firstSave = { ...project, name: 'First save' }
  const secondSave = { ...project, name: 'Second save' }
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

  console.log('mask safety tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
