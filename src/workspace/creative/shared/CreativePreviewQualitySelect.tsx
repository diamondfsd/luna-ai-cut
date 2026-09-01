import { Select } from '../../../ui'
import type { WorkspacePreviewQuality } from '../../../shared/types/settings'
import './creative-preview-quality.css'

interface CreativePreviewQualitySelectProps {
  value: WorkspacePreviewQuality
  onChange: (quality: WorkspacePreviewQuality) => void
  className?: string
}

export function CreativePreviewQualitySelect({ value, onChange, className }: CreativePreviewQualitySelectProps) {
  return (
    <Select
      className={`creative-preview-quality${className ? ` ${className}` : ''}`}
      variant="compact"
      placeholder="预览清晰度"
      value={value}
      options={[
        { value: 'smooth', label: '流畅' },
        { value: 'balanced', label: '平衡' },
        { value: 'high', label: '高清' },
        { value: 'original', label: '原画' },
      ]}
      onValueChange={(next) => onChange(next as WorkspacePreviewQuality)}
    />
  )
}
