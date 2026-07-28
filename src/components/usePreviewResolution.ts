import { useEffect, useState } from 'react'
import type { MediaResolution } from './previewStageGeometry'
import { getPreviewResolution, setPreviewResolution } from './previewResolutionCache'

export function usePreviewResolution(filePath: string | null): MediaResolution | null {
  const [resolution, setResolution] = useState<MediaResolution | null>(null)

  useEffect(() => {
    if (!filePath) {
      setResolution(null)
      return
    }
    const cached = getPreviewResolution(filePath)
    if (cached) {
      setResolution(cached)
      return
    }
    let canceled = false
    window.luna.workspace.getMediaResolution(filePath)
      .then((result) => {
        if (canceled) return
        setPreviewResolution(filePath, result)
        setResolution(result)
      })
      .catch(() => undefined)
    return () => { canceled = true }
  }, [filePath])

  return resolution
}
