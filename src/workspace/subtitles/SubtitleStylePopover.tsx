import { RotateCcw, SlidersHorizontal, Upload } from 'lucide-react'

import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_BUILTIN_FONT } from '../../shared/subtitleTrack'
import type { WorkspaceSubtitleFontAsset, WorkspaceSubtitleStyle } from '../../shared/types'
import { Button, ButtonGroup, IconButton, Popover, PopoverContent, PopoverTrigger, toast, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import { SubtitleFontSelect } from './SubtitleFontSelect'

interface SubtitleStylePopoverProps {
  style: WorkspaceSubtitleStyle
  onChange: (style: WorkspaceSubtitleStyle) => void
}

const WEIGHT_OPTIONS = [
  { value: '300', label: '细体' },
  { value: '400', label: '普通' },
  { value: '700', label: '粗体' },
]

export function SubtitleStylePopover({ style, onChange }: SubtitleStylePopoverProps) {
  const patch = (value: Partial<WorkspaceSubtitleStyle>): void => onChange({ ...style, ...value })

  const chooseFont = async (): Promise<void> => {
    try {
      const font = await window.luna.workspace.chooseSubtitleFont()
      if (!font) return
      const fontAssets = [...(style.fontAssets ?? []), font]
        .filter((asset, index, all) => all.findIndex((item) => item.filePath === asset.filePath) === index)
      patch({ customFont: font, fontAssets, fontFamily: font.fileName, fontFile: font.filePath })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const selectFont = (font: WorkspaceSubtitleFontAsset): void => patch(font.filePath === SUBTITLE_BUILTIN_FONT.filePath
    ? { customFont: undefined, fontFamily: DEFAULT_SUBTITLE_STYLE.fontFamily, fontFile: font.filePath }
    : { customFont: font, fontFamily: font.fileName, fontFile: font.filePath })
  const currentFont = style.customFont ?? SUBTITLE_BUILTIN_FONT

  return (
    <Popover>
      <Tooltip content="调整字幕样式">
        <PopoverTrigger asChild>
          <IconButton variant="ghost" size="mini" icon={<SlidersHorizontal size={16} />} aria-label="调整字幕样式" />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="workspace-subtitle-style-popover" side="left" align="start" sideOffset={10}>
        <header>
          <strong>字幕样式</strong>
          <Tooltip content="恢复默认样式">
            <IconButton variant="ghost" size="mini" icon={<RotateCcw size={15} />} aria-label="恢复默认字幕样式" onClick={() => onChange({ ...DEFAULT_SUBTITLE_STYLE, fontAssets: style.fontAssets })} />
          </Tooltip>
        </header>

        <div className="workspace-subtitle-style-scroll">
          <section>
            <h4>文字</h4>
            <div className="workspace-subtitle-font-row">
              <span>字体</span>
              <SubtitleFontSelect assets={style.fontAssets ?? []} value={currentFont} onChange={selectFont} />
            </div>
            <Button className="workspace-subtitle-font-import" size="mini" variant="secondary" icon={<Upload size={14} />} onClick={() => void chooseFont()}>导入字体</Button>
            <p className="workspace-subtitle-font-hint">支持 OTF、TTF 桌面字体，最大 30 MB；字体文件需包含所用文字的字形</p>
            <div className="workspace-subtitle-field-row">
              <span>字重</span>
              <ButtonGroup
                className="workspace-subtitle-weight-options"
                ariaLabel="字幕字重"
                value={String(style.fontWeight)}
                options={WEIGHT_OPTIONS}
                onChange={(value) => patch({ fontWeight: Number(value) as WorkspaceSubtitleStyle['fontWeight'] })}
              />
            </div>
            <ParamSlider label="字号" value={style.fontSize} min={24} max={96} step={1} onChange={(fontSize) => patch({ fontSize })} />
            <ColorControl label="文字颜色" value={style.textColor} onChange={(textColor) => patch({ textColor })} />
          </section>

          <section>
            <h4>背景</h4>
            <ColorControl label="背景颜色" value={style.backgroundColor} onChange={(backgroundColor) => patch({ backgroundColor })} />
            <ParamSlider label="背景透明度" value={style.backgroundOpacity} min={0} max={100} step={1} onChange={(backgroundOpacity) => patch({ backgroundOpacity })} formatValue={(value) => `${value}%`} />
            <ParamSlider label="圆角" value={style.cornerRadius} min={0} max={80} step={1} onChange={(cornerRadius) => patch({ cornerRadius })} />
            <ParamSlider label="边框宽度" value={style.borderWidth} min={0} max={12} step={1} onChange={(borderWidth) => patch({ borderWidth })} />
            <ColorControl label="边框颜色" value={style.borderColor} disabled={style.borderWidth === 0} onChange={(borderColor) => patch({ borderColor })} />
          </section>

          <section>
            <h4>位置</h4>
            <ParamSlider label="垂直位置" value={style.positionY} min={50} max={94} step={1} onChange={(positionY) => patch({ positionY })} formatValue={(value) => `${value}%`} />
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ColorControl({ label, value, disabled = false, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <div className={`workspace-subtitle-color-row${disabled ? ' is-disabled' : ''}`}>
      <span>{label}</span>
      <label>
        <input type="color" value={value} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.currentTarget.value.toUpperCase())} />
        <i style={{ background: value }} />
        <b>{value}</b>
      </label>
    </div>
  )
}
