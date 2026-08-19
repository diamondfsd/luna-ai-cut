import { App } from './app'
import './index.css'

export interface FreeCutEditorProps {
  [key: string]: unknown
}

export function FreeCutEditor(_props: FreeCutEditorProps) {
  return (
    <div className="freecut-app dark size-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
      <App />
    </div>
  )
}
