import { fileNameFromPath, mediaKindFromPath } from '../../lib/fileUtils'
import type { WorkspaceMediaAsset } from '../../shared/types'

export async function chooseWorkspaceMediaAssets(existingPaths: ReadonlySet<string>): Promise<WorkspaceMediaAsset[]> {
  const paths = await window.luna.workspace.chooseMediaFiles()
  const selectedPaths = new Set(existingPaths)
  return paths.reduce<WorkspaceMediaAsset[]>((assets, path) => {
    const kind = mediaKindFromPath(path)
    if ((kind !== 'image' && kind !== 'video') || selectedPaths.has(path)) return assets
    selectedPaths.add(path)
    assets.push({
      id: crypto.randomUUID(),
      name: fileNameFromPath(path),
      path,
      kind,
    })
    return assets
  }, [])
}
