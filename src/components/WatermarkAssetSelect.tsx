import { useMemo, useState } from 'react'
import { Check, ChevronDown, ImagePlus } from 'lucide-react'

import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { CustomWatermarkAsset } from '../shared/types'
import { matchesWatermarkFileName } from '../shared/watermarkLibrary'
import { Button, Popover, PopoverClose, PopoverContent, PopoverTrigger, SearchField } from '../ui'
import './WatermarkAssetSelect.css'

interface WatermarkAssetSelectProps {
  assets: CustomWatermarkAsset[]
  value?: CustomWatermarkAsset
  onChange: (asset: CustomWatermarkAsset) => void
}

export function WatermarkAssetSelect({ assets, value, onChange }: WatermarkAssetSelectProps) {
  const [search, setSearch] = useState('')
  const options = useMemo(() => {
    const available = value && !assets.some((asset) => asset.id === value.id) ? [value, ...assets] : assets
    return available.filter((asset) => matchesWatermarkFileName(asset.fileName, search))
  }, [assets, search, value])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="toolbar" className="wm-asset-select-trigger" aria-label="选择自定义水印">
          {value ? <img src={filePathToPreviewUrl(value.filePath) ?? ''} alt="" /> : <ImagePlus size={18} />}
          <span>{value?.fileName ?? '选择一个水印'}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="wm-asset-select-popover" align="start" sideOffset={6}>
        <div data-popover-header>选择自定义水印</div>
        {assets.length > 4 && (
          <SearchField
            variant="compact"
            fullWidth
            wrapperClassName="wm-asset-select-search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索水印"
            aria-label="按文件名搜索水印"
          />
        )}
        {options.length > 0 ? (
          <div
            className="wm-asset-select-options"
            role="listbox"
            aria-label="自定义水印"
            onWheel={(event) => event.stopPropagation()}
          >
            {options.map((asset) => (
              <PopoverClose key={asset.id} asChild>
                <Button
                  variant="secondary"
                  size="mini"
                  role="option"
                  aria-selected={value?.id === asset.id}
                  className={`wm-asset-select-option${value?.id === asset.id ? ' active' : ''}`}
                  onClick={() => onChange(asset)}
                  title={asset.fileName}
                >
                  <img src={filePathToPreviewUrl(asset.filePath) ?? ''} alt="" />
                  {value?.id === asset.id && (
                    <span className="wm-asset-select-check" aria-hidden="true"><Check size={11} /></span>
                  )}
                </Button>
              </PopoverClose>
            ))}
          </div>
        ) : <p className="wm-asset-select-empty">没有找到匹配的水印</p>}
      </PopoverContent>
    </Popover>
  )
}
