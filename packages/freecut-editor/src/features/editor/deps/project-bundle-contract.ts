/**
 * Adapter exports for project-bundle dependencies.
 * Editor modules should import project-bundle modules from here.
 */

export type { FixtureType } from '@freecut/features/project-bundle/services/test-fixtures'

export const importBundleExportDialog = () =>
  import('@freecut/features/project-bundle/components/bundle-export-dialog')
export const importTestFixtures = () => import('@freecut/features/project-bundle/services/test-fixtures')
export const importJsonExportService = () =>
  import('@freecut/features/project-bundle/services/json-export-service')
export const importJsonImportService = () =>
  import('@freecut/features/project-bundle/services/json-import-service')
