declare module '@freecut/embedded' {
  import type { ComponentType } from 'react'

  export type ImportMediaFiles = (files: File[]) => Promise<void>

  export interface FreeCutEditorProps {
    onRequestMediaImport?: (importFiles: ImportMediaFiles) => void
  }

  export const FreeCutEditor: ComponentType<FreeCutEditorProps>
}
