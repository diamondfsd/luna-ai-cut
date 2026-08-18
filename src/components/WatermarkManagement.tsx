import { useEffect, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { AppSettings, CustomWatermarkAsset, WatermarkPosition } from '../shared/types'
import { addCustomWatermarkAssets } from '../shared/watermarkLibrary'
import { Button, IconButton, LoadingIndicator, toast } from '../ui'
import { WatermarkSettings } from './WatermarkSettings'
import './WatermarkManagement.css'

interface WatermarkManagementProps {
  settings: AppSettings | null
  onDefaultChange: (watermark: { enabled: boolean; position: WatermarkPosition }) => void
}

export function WatermarkManagement({ settings, onDefaultChange }: WatermarkManagementProps) {
  const [assets, setAssets] = useState<CustomWatermarkAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.luna.listCustomWatermarks()
      .then((nextAssets) => { if (!cancelled) setAssets(nextAssets) })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '无法读取水印列表')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

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
    <div className="watermark-management">
      <section className="watermark-management-section">
        <div className="watermark-management-heading">
          <div>
            <h2>默认水印</h2>
            <p>新建编辑项目时使用的水印设置</p>
          </div>
        </div>
        <div className="watermark-management-default">
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
        </div>
      </section>

      <section className="watermark-management-section">
        <div className="watermark-management-heading">
          <div>
            <h2>自定义水印</h2>
            <p>导入后可在编辑时选择使用</p>
          </div>
          <Button variant="primary" size="compact" icon={<FolderOpen size={15} />} onClick={() => void handleAdd()}>
            添加水印
          </Button>
        </div>
        {loading ? <div className="watermark-management-empty"><LoadingIndicator label="正在读取水印" /></div> : assets.length > 0 ? (
          <div className="watermark-management-grid">
            {assets.map((asset) => (
              <article key={asset.id} className="watermark-management-item">
                <img src={filePathToPreviewUrl(asset.filePath) ?? ''} alt="" />
                <span title={asset.fileName}>{asset.fileName}</span>
                <IconButton
                  className="watermark-management-delete"
                  variant="ghost"
                  size="mini"
                  icon={<Trash2 size={14} />}
                  onClick={() => void handleDelete(asset)}
                  title={`删除 ${asset.fileName}`}
                  aria-label={`删除 ${asset.fileName}`}
                />
              </article>
            ))}
          </div>
        ) : <div className="watermark-management-empty">暂无自定义水印</div>}
      </section>
    </div>
  )
}
