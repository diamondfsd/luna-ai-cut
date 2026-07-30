import { RotateCcw, SlidersHorizontal, Upload } from 'lucide-react'

import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_FONT_WEIGHTS } from '../../shared/subtitleTrack'
import type { WorkspaceSubtitleStyle } from '../../shared/types'
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Select, toast, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'

interface SubtitleStylePopoverProps {
  style: WorkspaceSubtitleStyle
  onChange: (style: WorkspaceSubtitleStyle) => void
}

const WEIGHT_OPTIONS = [
  { value: '200', label: '纤细' },
  { value: '300', label: '细体' },
  { value: '350', label: '标准' },
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '700', label: '粗体' },
  { value: '900', label: '特粗' },
]

export function SubtitleStylePopover({ style, onChange }: SubtitleStylePopoverProps) {
  const patch = (value: Partial<WorkspaceSubtitleStyle>): void => onChange({ ...style, ...value })

  const chooseFont = async (): Promise<void> => {
    try {
      const font = await window.luna.workspace.chooseSubtitleFont()
      if (!font) return
      patch({ customFont: font, fontFamily: font.fileName, fontFile: font.filePath, fontWeight: 400 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const useBuiltinFont = (): void => patch({
    customFont: undefined,
    fontFamily: DEFAULT_SUBTITLE_STYLE.fontFamily,
    fontFile: SUBTITLE_FONT_WEIGHTS[style.fontWeight],
  })

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
            <IconButton variant="ghost" size="mini" icon={<RotateCcw size={15} />} aria-label="恢复默认字幕样式" onClick={() => onChange({ ...DEFAULT_SUBTITLE_STYLE })} />
          </Tooltip>
        </header>

        <div className="workspace-subtitle-style-scroll">
          <section>
            <h4>文字</h4>
            <div className="workspace-subtitle-font-row">
              <div><span>字体</span><strong title={style.customFont?.fileName}>{style.customFont?.fileName ?? '思源黑体'}</strong></div>
              <Button size="mini" variant="utility" icon={<Upload size={14} />} onClick={() => void chooseFont()}>导入</Button>
            </div>
            <p className="workspace-subtitle-font-hint">支持 OTF、TTF 桌面字体，最大 30 MB；字体文件需包含所用文字的字形</p>
            {style.customFont && <Button size="mini" variant="ghost" onClick={useBuiltinFont}>使用内置思源黑体</Button>}
            <div className="workspace-subtitle-field-row">
              <span>字重</span>
              <Select
                variant="compact"
                fullWidth
                contentClassName="workspace-subtitle-style-select-content"
                value={style.customFont ? undefined : String(style.fontWeight)}
                disabled={Boolean(style.customFont)}
                placeholder={style.customFont ? '由字体文件决定' : '字重'}
                options={WEIGHT_OPTIONS}
                onValueChange={(value) => {
                  const fontWeight = Number(value) as WorkspaceSubtitleStyle['fontWeight']
                  patch({ fontWeight, fontFile: SUBTITLE_FONT_WEIGHTS[fontWeight] })
                }}
              />
            </div>
            <ParamSlider label="字号" value={style.fontSize} min={24} max={96} step={1} onChange={(fontSize) => patch({ fontSize })} onCommit={(fontSize) => patch({ fontSize })} />
            <ColorControl label="文字颜色" value={style.textColor} onChange={(textColor) => patch({ textColor })} />
          </section>

          <section>
            <h4>背景</h4>
            <ColorControl label="背景颜色" value={style.backgroundColor} onChange={(backgroundColor) => patch({ backgroundColor })} />
            <ParamSlider label="背景透明度" value={style.backgroundOpacity} min={0} max={100} step={1} onChange={(backgroundOpacity) => patch({ backgroundOpacity })} onCommit={(backgroundOpacity) => patch({ backgroundOpacity })} formatValue={(value) => `${value}%`} />
            <ParamSlider label="圆角" value={style.cornerRadius} min={0} max={80} step={1} onChange={(cornerRadius) => patch({ cornerRadius })} onCommit={(cornerRadius) => patch({ cornerRadius })} />
            <ParamSlider label="边框宽度" value={style.borderWidth} min={0} max={12} step={1} onChange={(borderWidth) => patch({ borderWidth })} onCommit={(borderWidth) => patch({ borderWidth })} />
            <ColorControl label="边框颜色" value={style.borderColor} disabled={style.borderWidth === 0} onChange={(borderColor) => patch({ borderColor })} />
          </section>

          <section>
            <h4>位置</h4>
            <ParamSlider label="字幕区域宽度" value={style.width} min={50} max={96} step={1} onChange={(width) => patch({ width })} onCommit={(width) => patch({ width })} formatValue={(value) => `${value}%`} />
            <ParamSlider label="垂直位置" value={style.positionY} min={50} max={94} step={1} onChange={(positionY) => patch({ positionY })} onCommit={(positionY) => patch({ positionY })} formatValue={(value) => `${value}%`} />
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
