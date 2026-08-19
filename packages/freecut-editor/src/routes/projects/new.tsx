import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createLogger } from '@freecut/shared/logging/logger'
import { useCreateProject } from '@freecut/features/projects/hooks/use-project-actions'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { DEFAULT_PROJECT_VALUES } from '@freecut/features/projects/utils/validation'

const logger = createLogger('NewProject')

export const Route = createFileRoute('/projects/new')({
  component: NewProject,
  beforeLoad: async () => {
    try {
      const { loadProjects } = useProjectStore.getState()
      await loadProjects()
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err)
    }
  },
})

function NewProject() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const createProject = useCreateProject()
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const baseName = t('common.untitledProject')
    const existingNames = new Set(useProjectStore.getState().projects.map((project) => project.name))
    let projectName = baseName
    let suffix = 2
    while (existingNames.has(projectName)) {
      projectName = `${baseName} ${suffix}`
      suffix += 1
    }

    void createProject({
      ...DEFAULT_PROJECT_VALUES,
      name: projectName,
    }).then((result) => {
      if (result.success && result.project) {
        navigate({
          to: '/editor/$projectId',
          params: { projectId: result.project.id },
          replace: true,
        })
      } else {
        toast.error(t('projects.toasts.createFailed'), { description: result.error })
        navigate({ to: '/projects', replace: true })
      }
    })
  }, [createProject, navigate, t])

  return (
    <div className="flex size-full min-h-0 items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <p className="text-sm text-muted-foreground">{t('projects.creatingProject')}</p>
      </div>
    </div>
  )
}
