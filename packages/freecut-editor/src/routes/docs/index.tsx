import { createFileRoute } from '@tanstack/react-router'
import { DocsHome, DocsShell } from '@freecut/features/docs/docs-shell'

export const Route = createFileRoute('/docs/')({
  component: DocsIndexPage,
})

function DocsIndexPage() {
  return (
    <DocsShell>
      <DocsHome />
    </DocsShell>
  )
}
