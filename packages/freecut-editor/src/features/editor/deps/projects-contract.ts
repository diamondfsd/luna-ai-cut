/**
 * Adapter exports for projects dependencies.
 * Editor modules should import projects stores/services from here.
 */

export { useProjectStore } from '@freecut/features/projects/stores/project-store'
export { createProjectUpgradeBackup } from '@freecut/features/projects/services/project-upgrade-service'
export { formatProjectUpgradeBackupName } from '@freecut/features/projects/utils/project-helpers'
export { formatFpsValue, resolveAutoMatchProjectFps } from '@freecut/features/projects/utils/project-fps'
