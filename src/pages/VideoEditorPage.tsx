import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import type { ImportMediaFiles } from '@freecut/embedded'

import { LoadingIndicator } from '../ui'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'

const FreeCutEditor = lazy(async () => {
  const module = await import('@freecut/embedded')
  return { default: module.FreeCutEditor }
})

export function VideoEditorPage() {
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const pendingImportRef = useRef<ImportMediaFiles | null>(null)

  const handleRequestMediaImport = useCallback((importFiles: ImportMediaFiles) => {
    pendingImportRef.current = importFiles
    setImportDialogOpen(true)
  }, [])

  const handleImportPaths = useCallback(async (paths: string[]) => {
    const importFiles = pendingImportRef.current
    if (!importFiles) throw new Error('导入任务已取消')

    const uniquePaths = [...new Set(paths)]
    const files: File[] = []
    for (const filePath of uniquePaths) {
      const source = await window.luna.workspace.readMediaFile(filePath)
      files.push(new File([source.bytes], source.name, {
        type: source.mimeType,
        lastModified: source.lastModified,
      }))
    }
    await importFiles(files)
  }, [])

  const handleImportDialogOpenChange = useCallback((open: boolean) => {
    setImportDialogOpen(open)
    if (!open) pendingImportRef.current = null
  }, [])

  return (
    <>
      <Suspense fallback={<LoadingIndicator label="正在打开剪辑器" />}>
        <FreeCutEditor onRequestMediaImport={handleRequestMediaImport} />
      </Suspense>
      <WorkspaceImportDialog
        open={importDialogOpen}
        onOpenChange={handleImportDialogOpenChange}
        existingPaths={new Set()}
        onImportPaths={handleImportPaths}
        enableDirectoryImport
      />
    </>
  )
}
