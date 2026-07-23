import type { WorkspaceProject } from '../../shared/types'
import type { EditPipeline } from './editPipeline'

export function updateProjectAssetPipeline(
  project: WorkspaceProject,
  activeIndex: number,
  pipeline: EditPipeline,
): WorkspaceProject {
  if (!project.assets[activeIndex]) return project
  return {
    ...project,
    assets: project.assets.map((asset, index) => (
      index === activeIndex ? { ...asset, pipeline } : asset
    )),
  }
}
