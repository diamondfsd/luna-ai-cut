import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'

import { toast } from '../../ui'
import { mergeCompletedColorMaskLayer } from '../color/colorMaskLayerOperations'
import { composeMaskComponents } from '../mask/maskComponentRasterization'
import { createDefaultPipeline, type ColorMaskComponent, type ColorMaskLayer } from '../shared/editPipeline'
import type { MaskOperation } from '../mask/maskOperationIdentity'
import type { MaskComponentCommit } from './WorkspaceMaskContextTypes'

interface Options {
  activeMask: ColorMaskLayer | null
  maskSize: { width: number; height: number } | null
  projectId: string | null
  assetId: string | null
  colorMasksRef: MutableRefObject<ColorMaskLayer[]>
  beginOperation: (kind: MaskOperation['kind'], projectId: string, assetId: string, requestId?: string) => MaskOperation
  finishOperation: (operation: MaskOperation) => void
  isCurrentOperation: (operation: MaskOperation) => boolean
  commitLayers: (layers: ColorMaskLayer[]) => void
  setMaskData: (data: Uint8Array) => void
  setActiveLayerId: (id: string | null) => void
}

async function composeStoredComponents(
  projectId: string,
  width: number,
  height: number,
  components: ColorMaskComponent[],
): Promise<{ data: Uint8Array; components: ColorMaskComponent[] }> {
  const rasterData = new Map<string, Uint8Array>()
  const failedIds = new Set<string>()
  const rasterComponents = components.filter((component): component is Extract<ColorMaskComponent, { type: 'raster' }> => component.type === 'raster')
  await Promise.all(rasterComponents.map(async (component) => {
    try {
      const loaded = await window.luna.workspace.loadColorMask(projectId, component.path)
      rasterData.set(component.id, new Uint8Array(loaded.bytes))
    } catch {
      failedIds.add(component.id)
    }
  }))
  const availableComponents = failedIds.size === 0 ? components : components.map((component) => failedIds.has(component.id)
    ? { ...component, enabled: false, loadError: 'missing-or-damaged' as const }
    : component)
  return {
    data: composeMaskComponents(width, height, availableComponents, (component) => rasterData.get(component.id) ?? null),
    components: availableComponents,
  }
}

export async function rebuildMaskCache(
  projectId: string,
  assetId: string,
  width: number,
  height: number,
  components: ColorMaskComponent[],
  feather: number,
): Promise<{ data: Uint8Array; path: string; width: number; height: number; components: ColorMaskComponent[] }> {
  const composed = await composeStoredComponents(projectId, width, height, components)
  const saved = await window.luna.workspace.saveColorMask(
    projectId, assetId, width, height,
    composed.data.buffer.slice(composed.data.byteOffset, composed.data.byteOffset + composed.data.byteLength),
    feather,
  )
  return { data: composed.data, components: composed.components, ...saved }
}

function legacyComponents(mask: ColorMaskLayer | null): ColorMaskComponent[] {
  if (!mask?.path) return []
  return [{
    id: `component-base-${mask.id}`,
    type: 'raster',
    operation: 'replace',
    enabled: true,
    inverted: false,
    path: mask.path,
    width: mask.width,
    height: mask.height,
  }]
}

export function useMaskComponentPersistence(options: Options) {
  const {
    activeMask, maskSize, projectId, assetId, colorMasksRef,
    beginOperation, finishOperation, isCurrentOperation, commitLayers,
    setMaskData, setActiveLayerId,
  } = options
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null)
  const activeComponent = useMemo(
    () => activeMask?.components?.find((component) => component.id === activeComponentId) ?? null,
    [activeComponentId, activeMask?.components],
  )

  useEffect(() => {
    const components = activeMask?.components ?? []
    if (activeComponentId && components.some((component) => component.id === activeComponentId)) return
    const latestEditable = [...components].reverse().find((component) => component.enabled && !component.loadError && component.type !== 'raster')
    setActiveComponentId(latestEditable?.id ?? null)
  }, [activeComponentId, activeMask?.components])

  const saveFinalMask = useCallback(async (data: Uint8Array, components: ColorMaskComponent[] | undefined, nextActiveComponentId: string | null) => {
    if (!projectId || !assetId || !maskSize) throw new Error('请先在项目中打开一张图片')
    const operationMask = activeMask
    const feather = components?.some((component) => component.type !== 'raster') ? 0 : operationMask?.feather ?? 0
    const operation = beginOperation('save', projectId, assetId)
    try {
      const saved = await window.luna.workspace.saveColorMask(
        projectId,
        assetId,
        maskSize.width,
        maskSize.height,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        feather,
      )
      if (!isCurrentOperation(operation)) return
      setMaskData(new Uint8Array(data))
      const layerId = operationMask?.id ?? `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const layer: ColorMaskLayer = {
        path: saved.path,
        width: saved.width,
        height: saved.height,
        opacity: operationMask?.opacity ?? 1,
        inverted: operationMask?.inverted ?? false,
        feather,
        kind: operationMask?.kind ?? 'brush',
        classId: operationMask?.classId,
        className: operationMask?.className,
        targetId: operationMask?.targetId,
        modelId: operationMask?.modelId,
        id: layerId,
        name: operationMask?.name ?? `蒙版 ${colorMasksRef.current.length + 1}`,
        enabled: operationMask?.enabled ?? true,
        loadError: undefined,
        blendMode: operationMask?.blendMode ?? 'normal',
        color: operationMask?.color ?? createDefaultPipeline().color,
        componentSchemaVersion: components ? 1 : undefined,
        components,
      }
      const nextLayers = mergeCompletedColorMaskLayer(colorMasksRef.current, operationMask?.id ?? null, layer)
      if (nextLayers !== colorMasksRef.current) commitLayers(nextLayers)
      setActiveLayerId(layerId)
      setActiveComponentId(nextActiveComponentId)
    } finally {
      finishOperation(operation)
    }
  }, [activeMask, assetId, beginOperation, colorMasksRef, commitLayers, finishOperation, isCurrentOperation, maskSize, projectId, setActiveLayerId, setMaskData])

  const commitMask = useCallback(async (data: Uint8Array, componentCommit?: MaskComponentCommit) => {
    if (!projectId || !assetId || !maskSize) {
      toast.error('请先在项目中打开一张图片')
      return
    }
    try {
      let committedComponent = componentCommit?.component
      if (committedComponent?.type === 'raster' && componentCommit?.rasterData) {
        const saved = await window.luna.workspace.saveColorMask(
          projectId,
          assetId,
          maskSize.width,
          maskSize.height,
          componentCommit.rasterData.buffer.slice(
            componentCommit.rasterData.byteOffset,
            componentCommit.rasterData.byteOffset + componentCommit.rasterData.byteLength,
          ),
          0,
        )
        committedComponent = { ...committedComponent, path: saved.path, width: saved.width, height: saved.height }
      }
      const existing = activeMask?.components ?? legacyComponents(activeMask)
      let components = activeMask?.components
      if (committedComponent) {
        components = componentCommit?.replaceComponentId
          ? existing.map((component) => component.id === componentCommit.replaceComponentId ? committedComponent! : component)
          : committedComponent.operation === 'replace' ? [committedComponent] : [...existing, committedComponent]
      }
      await saveFinalMask(data, components, committedComponent?.id ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存蒙版失败')
    }
  }, [activeMask, assetId, maskSize, projectId, saveFinalMask])

  const saveComponentList = useCallback(async (components: ColorMaskComponent[], nextActiveComponentId: string | null) => {
    if (!projectId || !maskSize) return
    try {
      const composed = await composeStoredComponents(projectId, maskSize.width, maskSize.height, components)
      await saveFinalMask(composed.data, composed.components, nextActiveComponentId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新蒙版失败')
    }
  }, [maskSize, projectId, saveFinalMask])

  const removeActiveComponent = useCallback(async () => {
    if (!activeMask?.components || !activeComponentId) return
    const components = activeMask.components.filter((component) => component.id !== activeComponentId)
    await saveComponentList(components, components[components.length - 1]?.id ?? null)
  }, [activeComponentId, activeMask?.components, saveComponentList])

  const duplicateActiveComponent = useCallback(async () => {
    if (!activeMask?.components || !activeComponent) return
    const copy = { ...structuredClone(activeComponent), id: `component-${crypto.randomUUID()}` }
    const index = activeMask.components.findIndex((component) => component.id === activeComponent.id)
    const components = [...activeMask.components]
    components.splice(index + 1, 0, copy)
    await saveComponentList(components, copy.id)
  }, [activeComponent, activeMask?.components, saveComponentList])

  const updateActiveComponent = useCallback(async (component: ColorMaskComponent) => {
    if (!activeMask?.components || !activeComponentId || component.id !== activeComponentId) return
    await saveComponentList(
      activeMask.components.map((item) => item.id === activeComponentId ? component : item),
      activeComponentId,
    )
  }, [activeComponentId, activeMask?.components, saveComponentList])

  return {
    activeComponentId,
    activeComponent,
    setActiveComponentId,
    commitMask,
    removeActiveComponent,
    duplicateActiveComponent,
    updateActiveComponent,
    saveComponentList,
  }
}
