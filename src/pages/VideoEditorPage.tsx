import { useCallback, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EditorCore } from '@/core'
import ProjectsPage from '@/app/projects/page'
import EditorPage from '@/app/editor/[project_id]/page'
import {
  OpenCutNavigationProvider,
  type OpenCutRoute,
} from '@/platform/next-navigation'
import '../../packages/opencut-editor/src/app/globals.css'

export function VideoEditorPage() {
  const [route, setRoute] = useState<OpenCutRoute>({ page: 'projects' })

  const navigate = useCallback((nextRoute: OpenCutRoute) => {
    if (nextRoute.page === 'projects') {
      EditorCore.getInstance().project.closeProject()
    }
    setRoute(nextRoute)
  }, [])

  return (
    <OpenCutNavigationProvider route={route} onNavigate={navigate}>
      <div className="opencut-app size-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
        <TooltipProvider>
          <Toaster />
          {route.page === 'projects'
            ? <ProjectsPage />
            : <EditorPage projectId={route.projectId} />}
        </TooltipProvider>
      </div>
    </OpenCutNavigationProvider>
  )
}
