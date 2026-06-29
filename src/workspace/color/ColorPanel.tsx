import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Pipette, RotateCcw, Sparkles } from 'lucide-react'

import {
  WHITE_BALANCE_DEFAULTS,
  TONE_DEFAULTS,
  CURVE_DEFAULTS,
  HSL_DEFAULTS,
  COLOR_EDITOR_DEFAULTS,
  GRADING_DEFAULTS,
  SELECTIVE_COLOR_DEFAULTS,
  CALIBRATION_DEFAULTS,
  DETAIL_DEFAULTS,
  GRAIN_DEFAULTS,
  LENS_DEFAULTS,
  type ColorMixChannel,
  type EditPipeline,
  type HslAdjust,
  type SelectiveColorAdjust,
  type SelectiveColorChannel,
  type SelectiveColorMode,
  type ToneCurveBandAdjust,
  type ToneCurveChannel,
  type WhiteBalanceMode,
} from '../shared/editPipeline'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, ButtonGroup, IconButton, PillTabs, Tooltip } from '../../ui'

interface ColorPanelProps {
  value: EditPipeline['color']
  effects: EditPipeline['effects']
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onEffectsChange: (patch: Partial<EditPipeline['effects']>) => void
  onActivatePipette?: () => void
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

const CURVE_CHANNELS: Array<{ key: ToneCurveChannel; label: string }> = [
  { key: 'rgb', label: '全部' },
  { key: 'luminance', label: '亮' },
  { key: 'red', label: '红' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
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

function curveY(base: number, adjust: number): number {
  return Math.max(2, Math.min(130, base - adjust * 0.42))
}

function CurvePreview({ curve, onChange }: { curve: ToneCurveBandAdjust; onChange?: (patch: Partial<ToneCurveBandAdjust>) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<'shadows' | 'darks' | 'lights' | 'highlights' | null>(null)
  const shadowY = curveY(104, curve.shadows)
  const darkY = curveY(82, curve.darks)
  const lightY = curveY(46, curve.lights)
  const highlightY = curveY(12, curve.highlights)
  const curvePath = `M0 130 C30 ${shadowY} 52 ${darkY} 75 66 C105 ${lightY} 135 ${highlightY} 180 2`
  const points: Array<{ id: 'shadows' | 'darks' | 'lights' | 'highlights'; x: number; base: number }> = [
    { id: 'shadows', x: 20, base: 104 },
    { id: 'darks', x: 60, base: 82 },
    { id: 'lights', x: 108, base: 46 },
    { id: 'highlights', x: 158, base: 12 },
  ]
  const pointY: Record<string, number> = { shadows: shadowY, darks: darkY, lights: lightY, highlights: highlightY }

  function handlePointerDown(pointId: typeof dragging, event: React.PointerEvent): void {
    if (!onChange) return
    event.preventDefault()
    setDragging(pointId)
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent): void {
    if (!dragging || !onChange || !svgRef.current) return
    event.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const viewBoxY = Math.max(0, Math.min(132, ((event.clientY - rect.top) / rect.height) * 132))
    const point = points.find((p) => p.id === dragging)
    if (!point) return
    const adjust = Math.max(-100, Math.min(100, Math.round((point.base - viewBoxY) / 0.42)))
    onChange({ [dragging]: adjust })
  }

  function handlePointerUp(): void {
    if (!dragging) return
    setDragging(null)
  }

  return (
    <div className={`workspace-curve-preview${dragging ? ' dragging' : ''}`} aria-hidden="true">
      <svg
        ref={svgRef}
        viewBox="0 0 180 132"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
      >
        <path className="workspace-curve-grid" d="M45 0V132M90 0V132M135 0V132M0 33H180M0 66H180M0 99H180" />
        <path className="workspace-curve-fill" d={`${curvePath} L180 132 L0 132 Z`} />
        <path className="workspace-curve-line" d={curvePath} />
        {onChange && points.map(({ id, x }) => (
          <circle
            key={id}
            cx={x}
            cy={pointY[id]}
            r={6}
            fill="#fff"
            stroke="var(--blue)"
            strokeWidth={1.5}
            style={{ cursor: dragging === id ? 'grabbing' : 'grab' }}
            onPointerDown={(event) => handlePointerDown(id, event)}
          />
        ))}
        <circle cx="75" cy="66" r="3" fill="none" stroke="var(--muted)" strokeWidth={1} opacity={0.5} />
      </svg>
    </div>
  )
}

function ColorBarSlider({ color, children }: { color: string; children: ReactNode }) {
  return <div className="workspace-color-slider" style={{ '--workspace-slider-color': color } as CSSProperties}>{children}</div>
}

export function ColorPanel({ value, effects, onChange, onEffectsChange, onActivatePipette }: ColorPanelProps) {
  const [hslMode, setHslMode] = useState<'hue' | 'saturation' | 'luminance'>('hue')
  const [selectiveChannel, setSelectiveChannel] = useState<SelectiveColorChannel>('red')

  function updateHsl(channel: ColorMixChannel, patch: Partial<HslAdjust>): void {
    onChange({ hsl: { ...value.hsl, [channel]: { ...value.hsl[channel], ...patch } } })
  }

  function updateSelective(channel: SelectiveColorChannel, patch: Partial<SelectiveColorAdjust>): void {
    onChange({ selectiveColor: { ...value.selectiveColor, [channel]: { ...value.selectiveColor[channel], ...patch } } })
  }

  function updateCurve(channel: ToneCurveChannel, patch: Partial<ToneCurveBandAdjust>): void {
    onChange({ curve: { ...value.curve, channels: { ...value.curve.channels, [channel]: { ...value.curve.channels[channel], ...patch } } } })
  }

  const selective = value.selectiveColor[selectiveChannel]
  const activeCurveChannel = value.curve.activeChannel
  const activeCurve = value.curve.channels[activeCurveChannel]
  const modified = {
    whiteBalance: value.temperature !== 0 || value.tint !== 0 || value.whiteBalanceMode !== 'custom',
    tone: value.exposure !== 0 || value.contrast !== 0 || value.brightness !== 0 ||
           value.highlights !== 0 || value.shadows !== 0 || value.whites !== 0 || value.blacks !== 0 ||
           value.texture !== 0 || value.clarity !== 0 || value.dehaze !== 0 ||
           value.vibrance !== 0 || value.saturation !== 0,
    curve: activeCurve.highlights !== 0 || activeCurve.lights !== 0 || activeCurve.darks !== 0 || activeCurve.shadows !== 0,
    hsl: HSL_CHANNELS.some(ch => value.hsl[ch.key].hue !== 0 || value.hsl[ch.key].saturation !== 0 || value.hsl[ch.key].luminance !== 0),
    colorEditor: value.colorEditor.hue !== 224 || value.colorEditor.saturation !== 54 || value.colorEditor.smoothing !== 50 ||
                 value.colorEditor.luminanceSmoothing !== 50 || value.colorEditor.hueOffset !== 0 ||
                 value.colorEditor.saturationOffset !== 0 || value.colorEditor.brightnessOffset !== 0 || value.colorEditor.uniformity !== 0,
    grading: value.grading.shadowsSaturation !== 0 || value.grading.midtonesSaturation !== 0 || value.grading.highlightsSaturation !== 0 ||
             value.grading.blending !== 50 || value.grading.balance !== 0,
    selectiveColor: SELECTIVE_CHANNELS.some(ch =>
      value.selectiveColor[ch.key].cyan !== 0 || value.selectiveColor[ch.key].magenta !== 0 ||
      value.selectiveColor[ch.key].yellow !== 0 || value.selectiveColor[ch.key].black !== 0
    ) || value.selectiveColorMode !== 'relative',
    calibration: value.calibration.redHue !== 0 || value.calibration.redSaturation !== 0 ||
                 value.calibration.greenHue !== 0 || value.calibration.greenSaturation !== 0 ||
                 value.calibration.blueHue !== 0 || value.calibration.blueSaturation !== 0,
    detail: effects.sharpen !== 0 || effects.sharpenRadius !== 1 || effects.sharpenDetail !== 25 ||
            effects.sharpenMasking !== 0 || effects.noiseReduction !== 0 || effects.colorNoiseReduction !== 0,
    grain: effects.grainAmount !== 0 || effects.grainSize !== 25 || effects.grainRoughness !== 50,
    lens: effects.lensVignetting !== 0 || effects.vignette !== 0 || effects.chromaticAberration !== 0,
  }

  return (
    <div className="workspace-color-modules">
      <Accordion
        title="白平衡"
        defaultOpen
        modified={modified.whiteBalance}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(WHITE_BALANCE_DEFAULTS)} title="重置白平衡">
            <RotateCcw size={11} />
          </button>
        }
      >
        <div className="workspace-inline-control">
          <ButtonGroup
            options={[
              { value: 'auto', label: '自动' },
              { value: 'custom', label: '自定义' },
              { value: 'daylight', label: '日光' },
              { value: 'cloudy', label: '阴天' },
              { value: 'indoor', label: '室内' },
            ]}
            value={value.whiteBalanceMode}
            onChange={(whiteBalanceMode) => onChange({ whiteBalanceMode: whiteBalanceMode as WhiteBalanceMode })}
          />
          <Tooltip content="吸取白点">
            <IconButton variant="ghost" size="compact" icon={<Pipette size={16} />} onClick={onActivatePipette} />
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
        modified={modified.tone}
        actions={
          <>
            <IconButton variant="ghost" size="mini" icon={<Sparkles size={14} />} title="自动调整" />
            <button className="workspace-acc-reset" type="button" onClick={() => onChange(TONE_DEFAULTS)} title="重置影调">
              <RotateCcw size={11} />
            </button>
          </>
        }
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

      <Accordion
        title="曲线"
        modified={modified.curve}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(CURVE_DEFAULTS)} title="重置曲线">
            <RotateCcw size={11} />
          </button>
        }
      >
        <ButtonGroup
          options={CURVE_CHANNELS.map((c) => ({ value: c.key, label: c.label }))}
          value={activeCurveChannel}
          onChange={(activeChannel) => onChange({ curve: { ...value.curve, activeChannel: activeChannel as ToneCurveChannel } })}
        />
        <CurvePreview curve={activeCurve} onChange={(patch) => updateCurve(activeCurveChannel, patch)} />
        <ParamSlider label="高光" value={activeCurve.highlights} min={-100} max={100} onChange={(highlights) => updateCurve(activeCurveChannel, { highlights })} />
        <ParamSlider label="亮调" value={activeCurve.lights} min={-100} max={100} onChange={(lights) => updateCurve(activeCurveChannel, { lights })} />
        <ParamSlider label="暗调" value={activeCurve.darks} min={-100} max={100} onChange={(darks) => updateCurve(activeCurveChannel, { darks })} />
        <ParamSlider label="阴影" value={activeCurve.shadows} min={-100} max={100} onChange={(shadows) => updateCurve(activeCurveChannel, { shadows })} />
      </Accordion>

      <Accordion
        title="HSL"
        modified={modified.hsl}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(HSL_DEFAULTS)} title="重置HSL">
            <RotateCcw size={11} />
          </button>
        }
      >
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

      <Accordion
        title="色彩编辑器"
        modified={modified.colorEditor}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(COLOR_EDITOR_DEFAULTS)} title="重置色彩编辑器">
            <RotateCcw size={11} />
          </button>
        }
      >
        <div className="workspace-editor-wheel-row">
          <ColorWheel
            label="色彩编辑器"
            hue={value.colorEditor.hue}
            saturation={value.colorEditor.saturation}
            onChange={(hue, saturation) => onChange({ colorEditor: { ...value.colorEditor, hue, saturation } })}
          />
          <div className="workspace-editor-color-readout">
            <span style={{ background: hueColor(value.colorEditor.hue, value.colorEditor.saturation) }} />
            <strong>{value.colorEditor.hue}°</strong>
            <small>{value.colorEditor.saturation}%</small>
          </div>
        </div>
        <ParamSlider label="色彩平滑" value={value.colorEditor.smoothing} min={0} max={100} onChange={(smoothing) => onChange({ colorEditor: { ...value.colorEditor, smoothing } })} formatValue={String} />
        <ParamSlider label="亮度平滑" value={value.colorEditor.luminanceSmoothing} min={0} max={100} onChange={(luminanceSmoothing) => onChange({ colorEditor: { ...value.colorEditor, luminanceSmoothing } })} formatValue={String} />
        <ParamSlider label="色相偏移" value={value.colorEditor.hueOffset} min={-100} max={100} onChange={(hueOffset) => onChange({ colorEditor: { ...value.colorEditor, hueOffset } })} />
        <ParamSlider label="饱和偏移" value={value.colorEditor.saturationOffset} min={-100} max={100} onChange={(saturationOffset) => onChange({ colorEditor: { ...value.colorEditor, saturationOffset } })} />
        <ParamSlider label="明度偏移" value={value.colorEditor.brightnessOffset} min={-100} max={100} onChange={(brightnessOffset) => onChange({ colorEditor: { ...value.colorEditor, brightnessOffset } })} />
        <ParamSlider label="色彩均匀度" value={value.colorEditor.uniformity} min={0} max={100} onChange={(uniformity) => onChange({ colorEditor: { ...value.colorEditor, uniformity } })} formatValue={String} />
      </Accordion>

      <Accordion
        title="颜色分级"
        modified={modified.grading}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(GRADING_DEFAULTS)} title="重置颜色分级">
            <RotateCcw size={11} />
          </button>
        }
      >
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

      <Accordion
        title="可选颜色"
        modified={modified.selectiveColor}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(SELECTIVE_COLOR_DEFAULTS)} title="重置可选颜色">
            <RotateCcw size={11} />
          </button>
        }
      >
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
        <ButtonGroup
          options={[
            { value: 'relative', label: '相对' },
            { value: 'absolute', label: '绝对' },
          ]}
          value={value.selectiveColorMode}
          onChange={(selectiveColorMode) => onChange({ selectiveColorMode: selectiveColorMode as SelectiveColorMode })}
        />
      </Accordion>

      <Accordion
        title="校准"
        modified={modified.calibration}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(CALIBRATION_DEFAULTS)} title="重置校准">
            <RotateCcw size={11} />
          </button>
        }
      >
        <ColorBarSlider color="linear-gradient(90deg, #ff375f, #b6b6b6, #ff9f0a)">
          <ParamSlider label="红原色色相" value={value.calibration.redHue} min={-100} max={100} onChange={(redHue) => onChange({ calibration: { ...value.calibration, redHue } })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #ff453a, #b6b6b6, #30d158)">
          <ParamSlider label="红原色饱和" value={value.calibration.redSaturation} min={-100} max={100} onChange={(redSaturation) => onChange({ calibration: { ...value.calibration, redSaturation } })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #ffd60a, #b6b6b6, #30d158)">
          <ParamSlider label="绿原色色相" value={value.calibration.greenHue} min={-100} max={100} onChange={(greenHue) => onChange({ calibration: { ...value.calibration, greenHue } })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #ff453a, #b6b6b6, #30d158)">
          <ParamSlider label="绿原色饱和" value={value.calibration.greenSaturation} min={-100} max={100} onChange={(greenSaturation) => onChange({ calibration: { ...value.calibration, greenSaturation } })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #64d2ff, #b6b6b6, #bf5af2)">
          <ParamSlider label="蓝原色色相" value={value.calibration.blueHue} min={-100} max={100} onChange={(blueHue) => onChange({ calibration: { ...value.calibration, blueHue } })} />
        </ColorBarSlider>
        <ColorBarSlider color="linear-gradient(90deg, #ff453a, #b6b6b6, #0a84ff)">
          <ParamSlider label="蓝原色饱和" value={value.calibration.blueSaturation} min={-100} max={100} onChange={(blueSaturation) => onChange({ calibration: { ...value.calibration, blueSaturation } })} />
        </ColorBarSlider>
      </Accordion>

      <Accordion
        title="细节"
        modified={modified.detail}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onEffectsChange(DETAIL_DEFAULTS)} title="重置细节">
            <RotateCcw size={11} />
          </button>
        }
      >
        <ParamSlider label="锐化" value={effects.sharpen} min={0} max={150} onChange={(sharpen) => onEffectsChange({ sharpen })} formatValue={String} />
        <ParamSlider label="半径" value={effects.sharpenRadius} min={0.5} max={3} step={0.1} onChange={(sharpenRadius) => onEffectsChange({ sharpenRadius })} formatValue={decimalValue} />
        <ParamSlider label="细节" value={effects.sharpenDetail} min={0} max={100} onChange={(sharpenDetail) => onEffectsChange({ sharpenDetail })} formatValue={String} />
        <ParamSlider label="蒙版" value={effects.sharpenMasking} min={0} max={100} onChange={(sharpenMasking) => onEffectsChange({ sharpenMasking })} formatValue={String} />
        <ParamSlider label="噪点消除" value={effects.noiseReduction} min={0} max={100} onChange={(noiseReduction) => onEffectsChange({ noiseReduction })} formatValue={String} />
        <ParamSlider label="减少杂色" value={effects.colorNoiseReduction} min={0} max={100} onChange={(colorNoiseReduction) => onEffectsChange({ colorNoiseReduction })} formatValue={String} />
      </Accordion>

      <Accordion
        title="颗粒"
        modified={modified.grain}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onEffectsChange(GRAIN_DEFAULTS)} title="重置颗粒">
            <RotateCcw size={11} />
          </button>
        }
      >
        <ParamSlider label="数量" value={effects.grainAmount} min={0} max={100} onChange={(grainAmount) => onEffectsChange({ grainAmount })} formatValue={String} />
        <ParamSlider label="大小" value={effects.grainSize} min={0} max={100} onChange={(grainSize) => onEffectsChange({ grainSize })} formatValue={String} />
        <ParamSlider label="粗糙度" value={effects.grainRoughness} min={0} max={100} onChange={(grainRoughness) => onEffectsChange({ grainRoughness })} formatValue={String} />
      </Accordion>

      <Accordion
        title="镜头调整"
        modified={modified.lens}
        actions={
          <button className="workspace-acc-reset" type="button" onClick={() => onEffectsChange(LENS_DEFAULTS)} title="重置镜头">
            <RotateCcw size={11} />
          </button>
        }
      >
        <ParamSlider label="暗角调节" value={effects.lensVignetting} min={-100} max={100} onChange={(lensVignetting) => onEffectsChange({ lensVignetting })} />
        <ParamSlider label="创意暗角" value={effects.vignette} min={-100} max={100} onChange={(vignette) => onEffectsChange({ vignette })} />
        <ParamSlider label="色差" value={effects.chromaticAberration} min={0} max={100} onChange={(chromaticAberration) => onEffectsChange({ chromaticAberration })} formatValue={String} />
      </Accordion>
    </div>
  )
}
