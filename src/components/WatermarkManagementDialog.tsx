import { FolderOpen, Trash2 } from 'lucide-react'

import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { AppSettings, CustomWatermarkAsset, WatermarkPosition } from '../shared/types'
import { Button, Dialog, IconButton } from '../ui'
import { WatermarkSettings } from './WatermarkSettings'
import './WatermarkManagementDialog.css'

interface WatermarkManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings | null
  onDefaultChange: (watermark: { enabled: boolean; position: WatermarkPosition }) => void
  onAdd: () => Promise<void>
  onDelete: (asset: CustomWatermarkAsset) => Promise<void>
}

export function WatermarkManagementDialog({
  open,
  onOpenChange,
  settings,
  onDefaultChange,
  onAdd,
  onDelete,
}: WatermarkManagementDialogProps) {
  const assets = settings?.customWatermarkAssets ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="水印设置"
      tone="dark"
      className="watermark-management-dialog"
      footer={<Button variant="primary" onClick={() => onOpenChange(false)}>完成</Button>}
    >
      <div className="ui-dialog-body watermark-management-body">
        <section className="watermark-management-section">
          <h3>默认水印</h3>
          <WatermarkSettings
            preferencesOnly
            title="默认开启"
            settings={{
              enabled: settings?.defaultWatermarkEnabled ?? true,
              style: 'luna_ultra_cn',
              position: settings?.defaultWatermarkPosition === 'top-center'
                ? 'bottom-center'
                : settings?.defaultWatermarkPosition ?? 'bottom-center',
            }}
            onChange={onDefaultChange}
          />
        </section>

        <section className="watermark-management-section">
          <div className="watermark-management-heading">
            <h3>自定义水印</h3>
            <Button variant="primary" size="compact" icon={<FolderOpen size={15} />} onClick={() => void onAdd()}>
              添加水印
            </Button>
          </div>
          {assets.length > 0 ? (
            <div className="watermark-management-grid">
              {assets.map((asset) => (
                <article key={asset.id} className="watermark-management-card">
                  <img src={filePathToPreviewUrl(asset.filePath) ?? ''} alt="" />
                  <span title={asset.fileName}>{asset.fileName}</span>
                  <IconButton
                    className="watermark-management-delete"
                    variant="light"
                    size="mini"
                    icon={<Trash2 size={14} />}
                    onClick={() => void onDelete(asset)}
                    title={`删除 ${asset.fileName}`}
                    aria-label={`删除 ${asset.fileName}`}
                  />
                </article>
              ))}
            </div>
          ) : <p className="watermark-management-empty">暂无自定义水印</p>}
        </section>
      </div>
    </Dialog>
  )
}
