import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createLogger } from '@freecut/shared/logging/logger'
import { InlineCreateProjectForm } from '@freecut/features/projects/components/project-form'
import { useCreateProject } from '@freecut/features/projects/hooks/use-project-actions'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { FreeCutLogo } from '@freecut/components/brand/freecut-logo'
import { Button } from '@freecut/components/ui/button'
import { Github } from 'lucide-react'
import { DiscordIcon } from '@freecut/components/brand/discord-icon'
import { DISCORD_INVITE_URL } from '@freecut/config/community'
import type { ProjectFormData } from '@freecut/features/projects/utils/validation'

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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const createProject = useCreateProject()

  const handleSubmit = async (data: ProjectFormData) => {
    setIsSubmitting(true)

    try {
      const result = await createProject(data)

      if (result.success && result.project) {
        // Navigate to editor with new project
        navigate({
          to: '/editor/$projectId',
          params: { projectId: result.project.id },
        })
      } else {
        toast.error(t('projects.toasts.createFailed'), { description: result.error })
        setIsSubmitting(false)
      }
    } catch (error) {
      logger.error('Failed to create project:', error)
      toast.error(t('projects.toasts.createFailed'), { description: t('projects.tryAgain') })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="size-full min-h-0 overflow-auto bg-background">
      {/* Header */}
      <div className="panel-header border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/">
            <FreeCutLogo variant="full" size="md" className="hover:opacity-80 transition-opacity" />
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" className="gap-2" asChild>
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
                <DiscordIcon className="w-4 h-4" />
                Discord
              </a>
            </Button>
            <Button variant="outline" size="icon" className="h-10 w-10" asChild>
              <a
                href="https://github.com/walterlow/freecut"
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip={t('projects.viewOnGitHub')}
                data-tooltip-side="left"
              >
                <Github className="w-5 h-5" />
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <InlineCreateProjectForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      </div>
    </div>
  )
}
