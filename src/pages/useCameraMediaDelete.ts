import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppSettings, LunaFile } from '../shared/types'

interface CameraMediaDeleteProps {
  selectedFiles: LunaFile[]
  settings: AppSettings | null
  setSelected: Dispatch<SetStateAction<Set<string>>>
  reload: () => Promise<void>
}

export function useCameraMediaDelete({ selectedFiles, settings, setSelected, reload }: CameraMediaDeleteProps) {
  const [showCameraDeleteDialog, setShowCameraDeleteDialog] = useState(false)
  const [deletingCameraFiles, setDeletingCameraFiles] = useState(false)
  const [cameraDeleteError, setCameraDeleteError] = useState<string | null>(null)

  async function deleteSelectedCameraFiles(): Promise<void> {
    if (!settings || selectedFiles.length === 0 || deletingCameraFiles) return
    setDeletingCameraFiles(true)
    setCameraDeleteError(null)
    try {
      const result = await window.luna.deleteCameraFiles(selectedFiles, settings.cameraHost)
      if (result.failed.length > 0) {
        setCameraDeleteError(`${result.failed.length} 个相机文件未能删除，请刷新后重试`)
      }
      setSelected(new Set())
      setShowCameraDeleteDialog(false)
      await reload()
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
