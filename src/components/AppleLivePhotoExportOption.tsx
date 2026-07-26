import { Switch } from '../ui'
import './AppleLivePhotoExportOption.css'

interface AppleLivePhotoExportOptionProps {
  checked: boolean
  livePhotoCount: number
  batch: boolean
  onCheckedChange: (checked: boolean) => void
}

export function AppleLivePhotoExportOption({
  checked,
  livePhotoCount,
  batch,
  onCheckedChange,
}: AppleLivePhotoExportOptionProps) {
  if (!window.navigator.platform.includes('Mac') || livePhotoCount === 0) return null

  return (
    <div className="apple-live-photo-export-option">
      <div className="apple-live-photo-export-copy">
        <span>同时导出 Apple Live 图</span>
        <small>
          {batch
            ? `对本次选择中的 ${livePhotoCount} 张 Live 图生效`
            : '导出后保存到系统照片'}
        </small>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        ariaLabel="同时导出 Apple Live 图"
      />
    </div>
  )
}
