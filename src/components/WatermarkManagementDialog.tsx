import { useEffect, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { AppSettings, CustomWatermarkAsset, WatermarkPosition } from '../shared/types'
import { addCustomWatermarkAssets } from '../shared/watermarkLibrary'
import { Button, Dialog, IconButton, toast } from '../ui'
import { WatermarkSettings } from './WatermarkSettings'
import './WatermarkManagementDialog.css'

interface WatermarkManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings | null
  onDefaultChange: (watermark: { enabled: boolean; position: WatermarkPosition }) => void
}

export function WatermarkManagementDialog({
  open,
  onOpenChange,
  settings,
  onDefaultChange,
}: WatermarkManagementDialogProps) {
  const [assets, setAssets] = useState<CustomWatermarkAsset[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    window.luna.listCustomWatermarks()
      .then((nextAssets) => { if (!cancelled) setAssets(nextAssets) })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '无法读取水印列表')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  async function handleAdd(): Promise<void> {
    const additions = await window.luna.chooseCustomWatermarks().catch((error) => {
      toast.error(error instanceof Error ? error.message : '无法导入这张水印图片')
      return []
    })
    if (additions.length === 0) return
    setAssets((current) => addCustomWatermarkAssets(current, additions))
    toast.success(`已添加 ${additions.length} 个水印`)
  }

  async function handleDelete(asset: CustomWatermarkAsset): Promise<void> {
    try {
      setAssets(await window.luna.deleteCustomWatermark(asset.id))
      toast.success('水印已从列表中删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法删除这个水印')
    }
  }

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
            <Button variant="primary" size="compact" icon={<FolderOpen size={15} />} onClick={() => void handleAdd()}>
              添加水印
            </Button>
          </div>
          {loading ? <p className="watermark-management-empty">正在读取水印</p> : assets.length > 0 ? (
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
                    onClick={() => void handleDelete(asset)}
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
