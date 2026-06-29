import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Pipette, Sparkles } from 'lucide-react'

import type { ColorMixChannel, EditPipeline, HslAdjust, SelectiveColorAdjust, SelectiveColorChannel } from '../shared/editPipeline'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, Button, IconButton, PillTabs, Select, Switch, Tooltip } from '../../ui'

interface ColorPanelProps {
  value: EditPipeline['color']
  effects: EditPipeline['effects']
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onEffectsChange: (patch: Partial<EditPipeline['effects']>) => void
}

const HSL_CHANNELS: Array<{ key: ColorMixChannel; label: string; color: string }> = [
  { key: 'red', label: '红色', color: '#ff3b30' },
  { key: 'orange', label: '橙色', color: '#ff9500' },
  { key: 'yellow', label: '黄色', color: '#ffd60a' },
  { key: 'green', label: '绿色', color: '#34c759' },
  { key: 'aqua', label: '浅绿色', color: '#48d6d2' },
  { key: 'blue', label: '蓝色', color: '#0a84ff' },
  { key: 'purple', label: '紫色', color: '#bf5af2' },
  { key: 'magenta', label: '洋红色', color: '#ff2d9a' },
]

const SELECTIVE_CHANNELS: Array<{ key: SelectiveColorChannel; label: string; color: string }> = [
  { key: 'red', label: '红色', color: '#ff453a' },
  { key: 'yellow', label: '黄色', color: '#ffd60a' },
  { key: 'green', label: '绿色', color: '#30d158' },
  { key: 'cyan', label: '青色', color: '#64d2ff' },
  { key: 'blue', label: '蓝色', color: '#0a84ff' },
  { key: 'magenta', label: '洋红', color: '#ff2d9a' },
  { key: 'white', label: '白色', color: '#f5f5f7' },
  { key: 'neutral', label: '灰色', color: '#8e8e93' },
  { key: 'black', label: '黑色', color: '#050505' },
]

function exposureValue(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

function decimalValue(value: number): string {
  return value.toFixed(1)
}

function hueColor(hue: number, saturation: number): string {
  return `hsl(${hue} ${Math.max(12, saturation)}% 56%)`
}

function updateWheel(event: React.PointerEvent<HTMLButtonElement>, onChange: (hue: number, saturation: number) => void): void {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = event.clientX - rect.left - rect.width / 2
  const y = event.clientY - rect.top - rect.height / 2
  const radius = Math.max(1, rect.width / 2)
  const hue = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
  const saturation = Math.round(Math.min(100, Math.hypot(x, y) / radius * 100))
  onChange(hue, saturation)
}

function ColorWheel({
  label,
  hue,
  saturation,
  size = 'default',
  onChange,
}: {
  label: string
  hue: number
  saturation: number
  size?: 'default' | 'mini'
  onChange: (hue: number, saturation: number) => void
}) {
  const markerDistance = saturation / 2
  const radians = (hue * Math.PI) / 180
  return (
    <button
      type="button"
      aria-label={label}
      className={`workspace-color-wheel workspace-color-wheel-${size}`}
      onPointerDown={(event) => updateWheel(event, onChange)}
      onPointerMove={(event) => {
        if (event.buttons === 1) updateWheel(event, onChange)
      }}
    >
      <span
        className="workspace-color-wheel-marker"
        style={{
          transform: `translate(${Math.cos(radians) * markerDistance}px, ${Math.sin(radians) * markerDistance}px)`,
        }}
      />
    </button>
  )
}

function CurvePreview() {
  return (
    <div className="workspace-curve-preview" aria-hidden="true">
      <svg viewBox="0 0 180 132">
        <path className="workspace-curve-grid" d="M45 0V132M90 0V132M135 0V132M0 33H180M0 66H180M0 99H180" />
        <path className="workspace-curve-fill" d="M0 130 C30 104 52 92 75 66 C105 32 135 30 180 2 L180 132 L0 132 Z" />
        <path className="workspace-curve-line" d="M0 130 C30 104 52 92 75 66 C105 32 135 30 180 2" />
        <circle cx="75" cy="66" r="4" />
      </svg>
    </div>
  )
}

function ColorBarSlider({ color, children }: { color: string; children: ReactNode }) {
  return <div className="workspace-color-slider" style={{ '--workspace-slider-color': color } as CSSProperties}>{children}</div>
}

export function ColorPanel({ value, effects, onChange, onEffectsChange }: ColorPanelProps) {
  const [hslMode, setHslMode] = useState<'hue' | 'saturation' | 'luminance'>('hue')
  const [selectiveChannel, setSelectiveChannel] = useState<SelectiveColorChannel>('red')
  const [noiseEnabled, setNoiseEnabled] = useState(false)
  const [selectiveRelative, setSelectiveRelative] = useState(true)

  function updateHsl(channel: ColorMixChannel, patch: Partial<HslAdjust>): void {
    onChange({ hsl: { ...value.hsl, [channel]: { ...value.hsl[channel], ...patch } } })
  }

  function updateSelective(channel: SelectiveColorChannel, patch: Partial<SelectiveColorAdjust>): void {
    onChange({ selectiveColor: { ...value.selectiveColor, [channel]: { ...value.selectiveColor[channel], ...patch } } })
  }

  const selective = value.selectiveColor[selectiveChannel]

  return (
    <div className="workspace-color-modules">
      <Accordion title="白平衡" defaultOpen>
        <div className="workspace-inline-control">
          <Select
            variant="compact"
            fullWidth
            value="custom"
            options={[
              { value: 'auto', label: '自动' },
              { value: 'custom', label: '自定义' },
              { value: 'daylight', label: '日光' },
              { value: 'cloudy', label: '阴天' },
              { value: 'indoor', label: '室内' },
            ]}
          />
          <Tooltip content="吸取白点">
            <IconButton variant="ghost" size="compact" icon={<Pipette size={16} />} />
          </Tooltip>
        </div>
        <ColorBarSlider color="linear-gradient(90deg, #3958ff, #d9d3a5, #f5f15a)">
          <ParamSlider label="色温" value={value.temperature} min={-100} max={100} onChange={(temperature) => onChange({ temperature })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #35bd4b, #b6b6b6, #d936c7)">
          <ParamSlider label="色调" value={value.tint} min={-100} max={100} onChange={(tint) => onChange({ tint })} />
        </ColorBarSlider>
      </Accordion>

      <Accordion
        title="影调"
        defaultOpen
        actions={<IconButton variant="ghost" size="mini" icon={<Sparkles size={14} />} title="自动调整" />}
      >
        <ParamSlider label="曝光" value={value.exposure} min={-5} max={5} step={0.1} onChange={(exposure) => onChange({ exposure })} formatValue={exposureValue} />
        <ParamSlider label="对比度" value={value.contrast} min={-100} max={100} onChange={(contrast) => onChange({ contrast })} />
        <ParamSlider label="亮度" value={value.brightness} min={-100} max={100} onChange={(brightness) => onChange({ brightness })} />
        <ParamSlider label="高光" value={value.highlights} min={-100} max={100} onChange={(highlights) => onChange({ highlights })} />
        <ParamSlider label="阴影" value={value.shadows} min={-100} max={100} onChange={(shadows) => onChange({ shadows })} />
        <ParamSlider label="白色" value={value.whites} min={-100} max={100} onChange={(whites) => onChange({ whites })} />
        <ParamSlider label="黑色" value={value.blacks} min={-100} max={100} onChange={(blacks) => onChange({ blacks })} />
        <ParamSlider label="纹理" value={value.texture} min={-100} max={100} onChange={(texture) => onChange({ texture })} />
        <ParamSlider label="清晰度" value={value.clarity} min={-100} max={100} onChange={(clarity) => onChange({ clarity })} />
        <ParamSlider label="祛雾" value={value.dehaze} min={-100} max={100} onChange={(dehaze) => onChange({ dehaze })} />
        <ParamSlider label="鲜艳度" value={value.vibrance} min={-100} max={100} onChange={(vibrance) => onChange({ vibrance })} />
        <ParamSlider label="饱和度" value={value.saturation} min={-100} max={100} onChange={(saturation) => onChange({ saturation })} />
      </Accordion>

      <Accordion title="曲线">
        <div className="workspace-curve-toolbar">
          {['全部', '亮', '红', '绿', '蓝'].map((item) => (
            <Button key={item} variant="utility" size="mini" className="workspace-mini-choice">
              {item}
            </Button>
          ))}
        </div>
        <CurvePreview />
        <ParamSlider label="高光" value={value.highlights} min={-100} max={100} onChange={(highlights) => onChange({ highlights })} />
        <ParamSlider label="亮调" value={value.whites} min={-100} max={100} onChange={(whites) => onChange({ whites })} />
        <ParamSlider label="暗调" value={value.blacks} min={-100} max={100} onChange={(blacks) => onChange({ blacks })} />
        <ParamSlider label="阴影" value={value.shadows} min={-100} max={100} onChange={(shadows) => onChange({ shadows })} />
      </Accordion>

      <Accordion title="HSL">
        <PillTabs
          value={hslMode}
          onValueChange={(next) => setHslMode(next as typeof hslMode)}
          items={[
            { value: 'hue', label: '色相' },
            { value: 'saturation', label: '饱和度' },
            { value: 'luminance', label: '明亮度' },
          ]}
          className="workspace-panel-tabs"
        />
        {HSL_CHANNELS.map(({ key, label, color }) => (
          <ColorBarSlider key={key} color={`linear-gradient(90deg, ${color}, #ffffff, ${color})`}>
            <ParamSlider
              label={label}
              value={value.hsl[key][hslMode]}
              min={-100}
              max={100}
              onChange={(next) => updateHsl(key, { [hslMode]: next })}
            />
          </ColorBarSlider>
        ))}
      </Accordion>

      <Accordion title="色彩编辑器">
        <div className="workspace-editor-wheel-row">
          <ColorWheel
            label="色彩编辑器"
            hue={value.grading.midtonesHue}
            saturation={value.grading.midtonesSaturation}
            onChange={(midtonesHue, midtonesSaturation) => onChange({ grading: { ...value.grading, midtonesHue, midtonesSaturation } })}
          />
          <div className="workspace-editor-color-readout">
            <span style={{ background: hueColor(value.grading.midtonesHue, value.grading.midtonesSaturation) }} />
            <strong>{value.grading.midtonesHue}°</strong>
            <small>{value.grading.midtonesSaturation}%</small>
          </div>
        </div>
        <ParamSlider label="色彩平滑" value={value.grading.blending} min={0} max={100} onChange={(blending) => onChange({ grading: { ...value.grading, blending } })} formatValue={String} />
        <ParamSlider label="色相偏移" value={value.calibration.blueHue} min={-100} max={100} onChange={(blueHue) => onChange({ calibration: { ...value.calibration, blueHue } })} />
        <ParamSlider label="饱和偏移" value={value.calibration.blueSaturation} min={-100} max={100} onChange={(blueSaturation) => onChange({ calibration: { ...value.calibration, blueSaturation } })} />
      </Accordion>

      <Accordion title="颜色分级">
        <div className="workspace-grading-wheels">
          <div>
            <span>阴影</span>
            <ColorWheel size="mini" label="阴影颜色" hue={value.grading.shadowsHue} saturation={value.grading.shadowsSaturation} onChange={(shadowsHue, shadowsSaturation) => onChange({ grading: { ...value.grading, shadowsHue, shadowsSaturation } })} />
          </div>
          <div>
            <span>中间调</span>
            <ColorWheel size="mini" label="中间调颜色" hue={value.grading.midtonesHue} saturation={value.grading.midtonesSaturation} onChange={(midtonesHue, midtonesSaturation) => onChange({ grading: { ...value.grading, midtonesHue, midtonesSaturation } })} />
          </div>
          <div>
            <span>高光</span>
            <ColorWheel size="mini" label="高光颜色" hue={value.grading.highlightsHue} saturation={value.grading.highlightsSaturation} onChange={(highlightsHue, highlightsSaturation) => onChange({ grading: { ...value.grading, highlightsHue, highlightsSaturation } })} />
          </div>
        </div>
        <ParamSlider label="混合" value={value.grading.blending} min={0} max={100} onChange={(blending) => onChange({ grading: { ...value.grading, blending } })} formatValue={String} />
        <ParamSlider label="平衡" value={value.grading.balance} min={-100} max={100} onChange={(balance) => onChange({ grading: { ...value.grading, balance } })} />
      </Accordion>

      <Accordion title="可选颜色">
        <div className="workspace-color-swatches">
          {SELECTIVE_CHANNELS.map(({ key, label, color }) => (
            <button
              key={key}
              type="button"
              aria-label={label}
              className={selectiveChannel === key ? 'active' : ''}
              style={{ background: color }}
              onClick={() => setSelectiveChannel(key)}
            />
          ))}
        </div>
        <ColorBarSlider color="linear-gradient(90deg, #ff375f, #7ee7ef)">
          <ParamSlider label="青色" value={value.selectiveColor[selectiveChannel].cyan} min={-100} max={100} onChange={(cyan) => updateSelective(selectiveChannel, { cyan })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #30d158, #ff2d9a)">
          <ParamSlider label="洋红" value={value.selectiveColor[selectiveChannel].magenta} min={-100} max={100} onChange={(magenta) => updateSelective(selectiveChannel, { magenta })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #4057ff, #ffd60a)">
          <ParamSlider label="黄色" value={value.selectiveColor[selectiveChannel].yellow} min={-100} max={100} onChange={(yellow) => updateSelective(selectiveChannel, { yellow })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #ffffff, #000000)">
          <ParamSlider label="黑色" value={selective.black} min={-100} max={100} onChange={(black) => updateSelective(selectiveChannel, { black })} />
        </ColorBarSlider>
        <div className="workspace-radio-row">
          <Button
            variant="utility"
            size="mini"
            className={selectiveRelative ? 'workspace-mini-choice active' : 'workspace-mini-choice'}
            onClick={() => setSelectiveRelative(true)}
          >
            相对
          </Button>
          <Button
            variant="utility"
            size="mini"
            className={!selectiveRelative ? 'workspace-mini-choice active' : 'workspace-mini-choice'}
            onClick={() => setSelectiveRelative(false)}
          >
            绝对
          </Button>
        </div>
      </Accordion>

      <Accordion
        title="细节"
        actions={<Switch checked={noiseEnabled} onCheckedChange={setNoiseEnabled} ariaLabel="智能降噪" />}
      >
        <ParamSlider label="锐化" value={effects.sharpen} min={0} max={150} onChange={(sharpen) => onEffectsChange({ sharpen })} formatValue={String} />
        <ParamSlider label="半径" value={effects.sharpenRadius} min={0.5} max={3} step={0.1} onChange={(sharpenRadius) => onEffectsChange({ sharpenRadius })} formatValue={decimalValue} />
        <ParamSlider label="细节" value={effects.sharpenDetail} min={0} max={100} onChange={(sharpenDetail) => onEffectsChange({ sharpenDetail })} formatValue={String} />
        <ParamSlider label="蒙版" value={effects.sharpenMasking} min={0} max={100} onChange={(sharpenMasking) => onEffectsChange({ sharpenMasking })} formatValue={String} />
        <ParamSlider label="噪点消除" value={effects.noiseReduction} min={0} max={100} onChange={(noiseReduction) => onEffectsChange({ noiseReduction })} formatValue={String} />
        <ParamSlider label="减少杂色" value={effects.colorNoiseReduction} min={0} max={100} onChange={(colorNoiseReduction) => onEffectsChange({ colorNoiseReduction })} formatValue={String} />
      </Accordion>

      <Accordion title="颗粒">
        <ParamSlider label="数量" value={effects.grainAmount} min={0} max={100} onChange={(grainAmount) => onEffectsChange({ grainAmount })} formatValue={String} />
        <ParamSlider label="大小" value={effects.grainSize} min={0} max={100} onChange={(grainSize) => onEffectsChange({ grainSize })} formatValue={String} />
        <ParamSlider label="粗糙度" value={effects.grainRoughness} min={0} max={100} onChange={(grainRoughness) => onEffectsChange({ grainRoughness })} formatValue={String} />
      </Accordion>

      <Accordion title="镜头调整">
        <ParamSlider label="畸变矫正" value={effects.lensDistortion} min={-100} max={100} onChange={(lensDistortion) => onEffectsChange({ lensDistortion })} />
        <Switch checked={effects.lensVignetting !== 0} onCheckedChange={(checked) => onEffectsChange({ lensVignetting: checked ? 20 : 0 })} ariaLabel="边缘亮度" />
        <ParamSlider label="暗角调节" value={effects.lensVignetting} min={-100} max={100} onChange={(lensVignetting) => onEffectsChange({ lensVignetting })} />
        <ParamSlider label="色差" value={effects.chromaticAberration} min={0} max={100} onChange={(chromaticAberration) => onEffectsChange({ chromaticAberration })} formatValue={String} />
      </Accordion>
    </div>
  )
}
