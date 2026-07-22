import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppSettings, CameraConnectionMode, LunaFile } from '../shared/types'
import { toast } from '../ui'

interface CameraMediaDeleteProps {
  selectedFiles: LunaFile[]
  settings: AppSettings | null
  sourceMode: CameraConnectionMode
  setSelected: Dispatch<SetStateAction<Set<string>>>
  reload: () => Promise<void>
}

export function useCameraMediaDelete({ selectedFiles, settings, sourceMode, setSelected, reload }: CameraMediaDeleteProps) {
  const [showCameraDeleteDialog, setShowCameraDeleteDialog] = useState(false)
  const [deletingCameraFiles, setDeletingCameraFiles] = useState(false)
  const [cameraDeleteError, setCameraDeleteError] = useState<string | null>(null)

  async function deleteSelectedCameraFiles(): Promise<void> {
    if (!settings || selectedFiles.length === 0 || deletingCameraFiles) return
    setDeletingCameraFiles(true)
    setCameraDeleteError(null)
    try {
      const result = await window.luna.cameraSource.deleteFiles(selectedFiles, {
        mode: sourceMode,
        deviceId: settings.activeDeviceId,
        host: settings.cameraHost,
        rootPath: settings.mountedCameraRoot,
      })
      if (result.failed.length > 0) {
        setCameraDeleteError(`${result.failed.length} 个关联文件未能删除，请刷新后重试`)
      }
      setSelected(new Set())
      setShowCameraDeleteDialog(false)
      await reload()
      if (result.deleted.length > 0) toast.success(`已删除 ${result.deleted.length} 个相机文件`)
    } catch (error) {
      setCameraDeleteError(error instanceof Error ? error.message : String(error))
      setSelected(new Set())
      setShowCameraDeleteDialog(false)
      await reload()
    } finally {
      setDeletingCameraFiles(false)
    }
  }

  return {
    cameraDeleteError,
    deleteSelectedCameraFiles,
    deletingCameraFiles,
    setCameraDeleteError,
    setShowCameraDeleteDialog,
    showCameraDeleteDialog,
  }
}
