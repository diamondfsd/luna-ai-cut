import { lazy, Suspense } from 'react'

import { LoadingIndicator } from '../ui'

const FreeCutEditor = lazy(async () => {
  const module = await import('@freecut/embedded')
  return { default: module.FreeCutEditor }
})

export function VideoEditorPage() {
  return (
    <Suspense fallback={<LoadingIndicator label="正在打开剪辑器" />}>
      <FreeCutEditor />
    </Suspense>
  )
}
