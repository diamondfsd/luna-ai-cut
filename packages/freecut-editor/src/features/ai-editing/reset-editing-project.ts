import { updateProject } from '@freecut/infrastructure/storage'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { projectFromSourceFiles } from '@freecut/features/project-source/project-source-codec'
import { hydrateTimelineStoresFromProject } from '@freecut/features/timeline/stores/timeline-persistence'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'

export async function resetEditingProjectToInitial(projectId: string): Promise<void> {
  const bridge = getEmbeddedHostBridge().editingSourceGit
  if (!bridge) throw new Error('当前环境无法重置剪辑项目。')

  await bridge.resetToInitial(projectId)
  const project = await projectFromSourceFiles({
    read: (path) => bridge.read(projectId, path),
  })
  await hydrateTimelineStoresFromProject(project)
  const saved = await updateProject(projectId, {
    name: project.name,
    description: project.description,
    duration: project.duration,
    metadata: project.metadata,
    timeline: project.timeline,
    updatedAt: Date.now(),
  })
  useProjectStore.getState().setCurrentProject(saved)
}
