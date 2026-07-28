import { useCallback, useMemo, useState, type MutableRefObject } from 'react'

import { DEFAULT_VIDEO_EXPORT_SETTINGS, type VideoExportFormat, type VideoExportSettings, type WorkspaceMediaAsset, type WorkspaceMediaKind, type WorkspaceProject } from '../../../shared/types'
import { toast } from '../../../ui'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { queuePixelFlowBatchExport } from './pixelFlowBatchExport'
import { PIXEL_FLOW_IMAGE_EXPORT_SETTINGS } from './pixelFlowExport'
import type { PixelFlowEffectSettings } from './pixelFlowLayers'

interface UsePixelFlowBatchExportOptions {
  activeAsset: WorkspaceMediaAsset | null
  effectSettings: PixelFlowEffectSettings
  supportedMediaKinds?: readonly WorkspaceMediaKind[]
  pendingProjectRef: MutableRefObject<WorkspaceProject | null>
  onActiveMaskResolved: (paths: { maskPath?: string; skyMaskPath?: string; depthMaskPath: string }) => void
}

export function usePixelFlowBatchExport(options: UsePixelFlowBatchExportOptions) {
  const media = useWorkspaceMedia()
  const [exporting, setExporting] = useState(false)
  const exportableAssets = useMemo(() => {
    const selected = [...media.selectedIndices]
      .map((index) => media.media[index])
      .filter((asset): asset is WorkspaceMediaAsset => Boolean(asset) && !media.brokenPaths.has(asset.path))
      .filter((asset) => !options.supportedMediaKinds || options.supportedMediaKinds.includes(asset.kind))
    if (selected.length > 0) return selected
    return options.activeAsset && !media.brokenPaths.has(options.activeAsset.path) ? [options.activeAsset] : []
  }, [media.brokenPaths, media.media, media.selectedIndices, options.activeAsset, options.supportedMediaKinds])

  const hasImages = exportableAssets.some((asset) => asset.kind === 'image')
  const hasVideos = exportableAssets.some((asset) => asset.kind === 'video')
  const initialConfig = useMemo<VideoExportSettings>(() => hasImages
    ? {
        ...PIXEL_FLOW_IMAGE_EXPORT_SETTINGS,
        exportFormats: hasVideos ? ['video', 'google-live'] : ['google-live'],
      }
    : DEFAULT_VIDEO_EXPORT_SETTINGS, [hasImages, hasVideos])
  const allowedFormats: VideoExportFormat[] = hasImages
    ? hasVideos ? ['video', 'google-live', 'apple-live'] : ['google-live', 'apple-live']
    : ['video']

  const handleExport = useCallback(async (config: VideoExportSettings) => {
    const project = options.pendingProjectRef.current ?? media.currentProject
    if (!project || exportableAssets.length === 0) return
    setExporting(true)
    try {
      const result = await queuePixelFlowBatchExport({
        project,
        assets: exportableAssets,
        config,
        settings: options.effectSettings,
      })
      if (Object.keys(result.resolvedStates).length > 0) {
        const latestProject = options.pendingProjectRef.current?.id === project.id
          ? options.pendingProjectRef.current
          : project
        const nextProject = {
          ...latestProject,
          updatedAt: new Date().toISOString(),
          creative: {
            ...latestProject.creative,
            pixelFlowByAssetId: {
              ...latestProject.creative?.pixelFlowByAssetId,
              ...result.resolvedStates,
            },
          },
        }
        options.pendingProjectRef.current = nextProject
        media.setCurrentProject(nextProject)
        await window.luna.workspace.saveProject(nextProject)
        const activeResolved = options.activeAsset ? result.resolvedStates[options.activeAsset.id] : undefined
        if (activeResolved?.depthMaskPath) options.onActiveMaskResolved({
          maskPath: activeResolved.maskPath,
          skyMaskPath: activeResolved.skyMaskPath,
          depthMaskPath: activeResolved.depthMaskPath,
        })
      }
      if (result.failedCount === 0) toast.success(`已加入 ${result.queuedCount} 个导出任务`)
      else if (result.queuedCount > 0) toast.show(`已加入 ${result.queuedCount} 个，${result.failedCount} 个准备失败`)
      else toast.error('没有可导出的素材，请查看素材是否可用')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法开始导出')
      throw error
    } finally {
      setExporting(false)
    }
  }, [exportableAssets, media, options])

  return { allowedFormats, exportableAssets, exporting, handleExport, hasImages, initialConfig }
}
