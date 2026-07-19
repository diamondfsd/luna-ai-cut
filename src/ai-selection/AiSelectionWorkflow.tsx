import { Check, FolderOpen, Layers3, Sparkles } from 'lucide-react'

interface AiSelectionWorkflowProps {
  status?: string
  selectedCount?: number
}

const steps = [
  { label: '添加素材', icon: FolderOpen },
  { label: '自动整理', icon: Sparkles },
  { label: '比较确认', icon: Layers3 },
  { label: '完成选片', icon: Check },
]

export function AiSelectionWorkflow({ status, selectedCount = 0 }: AiSelectionWorkflowProps) {
  const running = status === 'queued' || status === 'indexing' || status === 'analyzing'
  const activeIndex = !status ? 0 : running ? 1 : selectedCount > 0 ? 3 : 2

  return <ol className="ai-selection-workflow" aria-label="选片步骤">
    {steps.map((step, index) => {
      const Icon = step.icon
      const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : ''
      return <li key={step.label} className={state} aria-current={state === 'active' ? 'step' : undefined}>
        <span><Icon size={13} /></span>
        <strong>{step.label}</strong>
      </li>
    })}
  </ol>
}
