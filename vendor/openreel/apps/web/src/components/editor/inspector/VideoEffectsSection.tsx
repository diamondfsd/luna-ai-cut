import React, { useCallback, useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  RotateCcw,
  Eye,
  EyeOff,
  GripVertical,
  Copy,
  Search,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftPopover as Popover } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import type {
  VideoEffect,
  VideoEffectType,
} from "../../../bridges/effects-bridge";
import {
  getMotionShaderDef,
  getMotionShaderEffectDefs,
  defaultMotionShaderParams,
} from "@openreel/core";
import { ColorSelector } from "../../../motion/components/primitives";
import { ShaderPreviewBrowser } from "../../shaders/ShaderPreviewBrowser";
import {
  EDITOR_EFFECT_CATEGORIES,
  EDITOR_EFFECT_PREVIEWS,
  type EditorEffectPreviewDef,
} from "../panels/EffectsTransitionsPanel";
import {
  cloneVideoEffectStackWithFreshIds,
  copyVideoEffectStack,
  hasVideoEffectStackClipboard,
} from "../../../utils/video-effect-stack-clipboard";

function shaderEffectNumberValue(
  value: unknown,
  fallback: number | string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
}

function effectNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const VIDEO_EFFECT_CATEGORY_LABELS: Record<string, string> = {
  Basic: "基础",
  Color: "色彩",
  Blur: "模糊",
  Creative: "创意",
  Stylize: "风格化",
};

const VIDEO_SHADER_LABELS: Record<string, string> = {
  dither: "抖动",
  "gradient-map": "渐变映射",
  pixelate: "像素化",
  halftone: "半色调",
  vhs: "VHS",
  posterize: "色调分离",
  duotone: "双调",
  prism: "棱镜分离",
  fisheye: "鱼眼",
  "wave-warp": "波浪扭曲",
  scanlines: "扫描线",
  "edge-glow": "边缘发光",
};

const VIDEO_EFFECT_PARAM_LABELS: Record<string, string> = {
  Amount: "强度",
  Angle: "角度",
  Amplitude: "振幅",
  Background: "背景",
  Blur: "模糊",
  Brightness: "亮度",
  Contrast: "对比度",
  "Center X": "中心 X",
  "Center Y": "中心 Y",
  Density: "密度",
  Distance: "距离",
  "Dot Size": "点大小",
  Feather: "羽化",
  Frequency: "频率",
  "Glow Color": "光晕颜色",
  Highlight: "高光",
  Intensity: "强度",
  Jitter: "抖动",
  Levels: "色阶",
  Mix: "混合",
  Midpoint: "中点",
  Offset: "偏移",
  "Offset X": "偏移 X",
  "Offset Y": "偏移 Y",
  Opacity: "不透明度",
  Radius: "半径",
  Scale: "缩放",
  Scanlines: "扫描线",
  Separation: "分离",
  Shadow: "阴影",
  Size: "大小",
  Softness: "柔和度",
  Speed: "速度",
  Strength: "强度",
  Threshold: "阈值",
  Tint: "色调",
  Value: "值",
};

function localizeVideoEffectParamLabel(label: string): string {
  return VIDEO_EFFECT_PARAM_LABELS[label] ?? label;
}

function localizeVideoShaderName(shaderId: string, name: string): string {
  return VIDEO_SHADER_LABELS[shaderId] ?? name;
}

function shaderEffectColorValue(
  value: unknown,
  fallback: number | string,
): string {
  if (typeof value === "string") return value;
  if (typeof fallback === "string") return fallback;
  return "#ffffff";
}

const EffectColorField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-2">
    <Text type="supporting" color="secondary" className="text-[10px]">
      {label}
    </Text>
    <div className="flex max-w-[150px] items-center">
      <ColorSelector
        value={value}
        onChange={onChange}
        label={`选择${label}`}
      />
    </div>
  </div>
);

const EffectSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min, max, step = 1, unit = "" }) => (
  <PropertySlider
    label={localizeVideoEffectParamLabel(label)}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    formatValue={(nextValue) =>
      `${step < 1 ? Number(nextValue.toFixed(2)) : Math.round(nextValue)}${unit}`
    }
  />
);

/**
 * Effect Item Component - displays a single effect with controls
 */
const EffectItem: React.FC<{
  effect: VideoEffect;
  onUpdate: (effectId: string, params: Record<string, unknown>) => void;
  onToggle: (effectId: string, enabled: boolean) => void;
  onRemove: (effectId: string) => void;
  onDuplicate: (effectId: string) => void;
  onMove: (effectId: string, delta: -1 | 1) => void;
  onDropEffect: (sourceEffectId: string, targetEffectId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}> = ({
  effect,
  onUpdate,
  onToggle,
  onRemove,
  onDuplicate,
  onMove,
  onDropEffect,
  canMoveUp,
  canMoveDown,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const effectLabels: Record<VideoEffectType, string> = {
    brightness: "亮度",
    contrast: "对比度",
    saturation: "饱和度",
    grayscale: "灰度",
    sepia: "棕褐色",
    invert: "反相",
    hue: "色相",
    blur: "模糊",
    sharpen: "锐化",
    vignette: "暗角",
    grain: "胶片颗粒",
    temperature: "色温",
    tint: "色调偏移",
    tonal: "色调平衡",
    chromaKey: "色键",
    shadow: "投影",
    glow: "光晕",
    "motion-blur": "动态模糊",
    "radial-blur": "径向模糊",
    "chromatic-aberration": "色差",
    shader: "材质效果",
  };

  const shaderDef =
    effect.type === "shader"
      ? getMotionShaderDef(String(effect.params.shaderId ?? ""))
      : undefined;

  const headerLabel =
    effect.type === "shader"
      ? shaderDef
        ? localizeVideoShaderName(String(effect.params.shaderId ?? ""), shaderDef.name)
        : "未知效果"
      : effectLabels[effect.type] || effect.type;

  const renderParams = () => {
    if (effect.type === "shader") {
      if (!shaderDef) {
        return (
          <Text type="supporting" color="secondary" className="text-[10px]">
            未知效果
          </Text>
        );
      }
      return (
        <>
          {shaderDef.params.map((param) => {
            if (param.type === "color") {
              return (
                <EffectColorField
                  key={param.name}
                  label={localizeVideoEffectParamLabel(param.label)}
                  value={shaderEffectColorValue(
                    effect.params[param.name],
                    param.default,
                  )}
                  onChange={(v) => onUpdate(effect.id, { [param.name]: v })}
                />
              );
            }
            return (
              <EffectSlider
                key={param.name}
                label={localizeVideoEffectParamLabel(param.label)}
                value={shaderEffectNumberValue(
                  effect.params[param.name],
                  param.default,
                )}
                onChange={(v) => onUpdate(effect.id, { [param.name]: v })}
                min={param.min}
                max={param.max}
                step={param.step}
              />
            );
          })}
        </>
      );
    }
    switch (effect.type) {
      case "brightness":
        return (
          <EffectSlider
            label="Value"
            value={effectNumberValue(effect.params.value, 0)}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "contrast":
        return (
          <EffectSlider
            label="Value"
            value={effectNumberValue(effect.params.value, 1) * 100}
            onChange={(v) => onUpdate(effect.id, { value: v / 100 })}
            min={0}
            max={200}
            unit="%"
          />
        );
      case "saturation":
        return (
          <EffectSlider
            label="Value"
            value={effectNumberValue(effect.params.value, 1) * 100}
            onChange={(v) => onUpdate(effect.id, { value: v / 100 })}
            min={0}
            max={200}
            unit="%"
          />
        );
      case "grayscale":
      case "sepia":
      case "invert":
        return (
          <EffectSlider
            label="Amount"
            value={effectNumberValue(effect.params.amount, 1) * 100}
            onChange={(v) => onUpdate(effect.id, { amount: v / 100 })}
            min={0}
            max={100}
            unit="%"
          />
        );
      case "blur":
        return (
          <EffectSlider
            label="Radius"
            value={effectNumberValue(effect.params.radius, 0)}
            onChange={(v) => onUpdate(effect.id, { radius: v })}
            min={0}
            max={100}
            unit="px"
          />
        );
      case "sharpen":
        return (
          <>
            <EffectSlider
              label="Amount"
              value={effectNumberValue(effect.params.amount, 0)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={200}
              unit="%"
            />
            <EffectSlider
              label="Radius"
              value={effectNumberValue(effect.params.radius, 1)}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0.1}
              max={10}
              step={0.1}
            />
          </>
        );
      case "vignette":
        return (
          <>
            <EffectSlider
              label="Amount"
              value={effectNumberValue(effect.params.amount, 0)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label="Midpoint"
              value={effectNumberValue(effect.params.midpoint, 0.5) * 100}
              onChange={(v) => onUpdate(effect.id, { midpoint: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label="Feather"
              value={effectNumberValue(effect.params.feather, 0.3) * 100}
              onChange={(v) => onUpdate(effect.id, { feather: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "grain":
        return (
          <>
            <EffectSlider
              label="Amount"
              value={effectNumberValue(effect.params.amount, 0)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label="Size"
              value={effectNumberValue(effect.params.size, 1)}
              onChange={(v) => onUpdate(effect.id, { size: v })}
              min={0.5}
              max={5}
              step={0.1}
            />
          </>
        );
      case "temperature":
        return (
          <EffectSlider
            label="Value"
            value={effectNumberValue(effect.params.value, 0)}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "tint":
        return (
          <EffectSlider
            label="Value"
            value={effectNumberValue(effect.params.value, 0)}
            onChange={(v) => onUpdate(effect.id, { value: v })}
            min={-100}
            max={100}
          />
        );
      case "shadow":
        return (
          <>
            <EffectSlider
              label="Offset X"
              value={effectNumberValue(effect.params.offsetX, 5)}
              onChange={(v) => onUpdate(effect.id, { offsetX: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Offset Y"
              value={effectNumberValue(effect.params.offsetY, 5)}
              onChange={(v) => onUpdate(effect.id, { offsetY: v })}
              min={-100}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Blur"
              value={effectNumberValue(effect.params.blur, 10)}
              onChange={(v) => onUpdate(effect.id, { blur: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Opacity"
              value={effectNumberValue(effect.params.opacity, 0.8) * 100}
              onChange={(v) => onUpdate(effect.id, { opacity: v / 100 })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "glow":
        return (
          <>
            <EffectSlider
              label="Radius"
              value={effectNumberValue(effect.params.radius, 10)}
              onChange={(v) => onUpdate(effect.id, { radius: v })}
              min={0}
              max={100}
              unit="px"
            />
            <EffectSlider
              label="Intensity"
              value={effectNumberValue(effect.params.intensity, 1) * 100}
              onChange={(v) => onUpdate(effect.id, { intensity: v / 100 })}
              min={0}
              max={300}
              unit="%"
            />
          </>
        );
      case "motion-blur":
        return (
          <>
            <EffectSlider
              label="Angle"
              value={effectNumberValue(effect.params.angle, 0)}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
            <EffectSlider
              label="Distance"
              value={effectNumberValue(effect.params.distance, 20)}
              onChange={(v) => onUpdate(effect.id, { distance: v })}
              min={0}
              max={100}
              unit="px"
            />
          </>
        );
      case "radial-blur":
        return (
          <>
            <EffectSlider
              label="Amount"
              value={effectNumberValue(effect.params.amount, 20)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={100}
            />
            <EffectSlider
              label="Center X"
              value={effectNumberValue(effect.params.centerX, 50)}
              onChange={(v) => onUpdate(effect.id, { centerX: v })}
              min={0}
              max={100}
              unit="%"
            />
            <EffectSlider
              label="Center Y"
              value={effectNumberValue(effect.params.centerY, 50)}
              onChange={(v) => onUpdate(effect.id, { centerY: v })}
              min={0}
              max={100}
              unit="%"
            />
          </>
        );
      case "chromatic-aberration":
        return (
          <>
            <EffectSlider
              label="Amount"
              value={effectNumberValue(effect.params.amount, 5)}
              onChange={(v) => onUpdate(effect.id, { amount: v })}
              min={0}
              max={50}
              step={0.5}
              unit="px"
            />
            <EffectSlider
              label="Angle"
              value={effectNumberValue(effect.params.angle, 0)}
              onChange={(v) => onUpdate(effect.id, { angle: v })}
              min={0}
              max={360}
              unit="°"
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-effect-id={effect.id}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-openreel-effect-order")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const sourceEffectId = event.dataTransfer.getData(
          "application/x-openreel-effect-order",
        );
        if (!sourceEffectId) return;
        event.preventDefault();
        onDropEffect(sourceEffectId, effect.id);
      }}
    >
      <Card
        variant="muted"
        padding={0}
        className={!effect.enabled ? "opacity-60" : undefined}
      >
        <div className="flex items-center gap-1 border-b border-border/70 bg-bg-2 px-2 py-2">
          <button
            type="button"
            draggable
            aria-label={`重新排列${headerLabel}`}
            title="拖动以重新排列效果"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                "application/x-openreel-effect-order",
                effect.id,
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && canMoveUp) {
                event.preventDefault();
                onMove(effect.id, -1);
              } else if (event.key === "ArrowDown" && canMoveDown) {
                event.preventDefault();
                onMove(effect.id, 1);
              }
            }}
            className="grid h-6 w-5 shrink-0 cursor-grab place-items-center rounded text-fg-3 hover:bg-hover hover:text-fg active:cursor-grabbing"
          >
            <GripVertical size={12} aria-hidden />
          </button>
          <Button
            label={headerLabel}
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            icon={
              <ChevronDown
                size={12}
                className={`transition-transform ${
                  isExpanded ? "" : "-rotate-90"
                } text-fg-3`}
                aria-hidden
              />
            }
            className="min-w-0 flex-1 justify-start"
          />
          <IconButton
            label={`将${headerLabel}上移`}
            onClick={() => onMove(effect.id, -1)}
            isDisabled={!canMoveUp}
            variant="ghost"
            size="sm"
            icon={<ArrowUp size={11} aria-hidden />}
          />
          <IconButton
            label={`将${headerLabel}下移`}
            onClick={() => onMove(effect.id, 1)}
            isDisabled={!canMoveDown}
            variant="ghost"
            size="sm"
            icon={<ArrowDown size={11} aria-hidden />}
          />
          <IconButton
            label={effect.enabled ? "停用效果" : "启用效果"}
            onClick={() => onToggle(effect.id, !effect.enabled)}
            variant="ghost"
            size="sm"
            icon={
              effect.enabled ? (
                <Eye size={12} className="text-fg-2" aria-hidden />
              ) : (
                <EyeOff size={12} className="text-fg-3" aria-hidden />
              )
            }
          />
          <IconButton
            label="复制效果"
            onClick={() => onDuplicate(effect.id)}
            variant="ghost"
            size="sm"
            icon={<Copy size={12} aria-hidden />}
          />
          <IconButton
            label="移除效果"
            onClick={() => onRemove(effect.id)}
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={12} aria-hidden />}
            className="text-fg-3 hover:text-red-400"
          />
        </div>
        {isExpanded && <div className="p-3 space-y-3">{renderParams()}</div>}
      </Card>
    </div>
  );
};

function VisualEffectPreview({
  def,
  onSelect,
}: {
  def: EditorEffectPreviewDef;
  onSelect: (def: EditorEffectPreviewDef) => void;
}): React.ReactElement {
  const effectedStyle = def.previewStyle(0.82);
  return (
    <button
      type="button"
      aria-label={`预览并添加${def.label}`}
      onClick={() => onSelect(def)}
      className="group min-w-0 rounded-[9px] border border-border bg-bg-2 p-1.5 text-left transition-colors hover:border-accent/60 hover:bg-bg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="relative block h-[66px] overflow-hidden rounded-[7px] bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)]">
        <span className="absolute inset-0 grid place-items-center text-lg font-black tracking-tight text-white/95">
          Aa
        </span>
        <span
          className="absolute inset-0 grid place-items-center overflow-hidden border-l border-white/45 bg-[linear-gradient(135deg,#22d3ee,#8b5cf6_52%,#fb7185)] text-lg font-black tracking-tight text-white/95"
          style={{
            ...effectedStyle,
            clipPath: "inset(0 0 0 50%)",
          }}
        >
          Aa
        </span>
        <span className="absolute bottom-1 left-1 rounded bg-black/45 px-1 py-0.5 text-[8px] font-semibold uppercase text-white/75">
          原始
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-semibold uppercase text-white/90">
          效果
        </span>
      </span>
      <span className="mt-1.5 block truncate text-[11px] font-semibold text-fg-2">
        {def.label}
      </span>
      <span className="block truncate text-[9px] text-fg-4">
        {VIDEO_EFFECT_CATEGORY_LABELS[def.category] ?? def.category} · {def.description}
      </span>
    </button>
  );
}

const EffectTypeSelector: React.FC<{
  onSelect: (def: EditorEffectPreviewDef) => void;
  onSelectShader: (shaderId: string) => void;
}> = ({ onSelect, onSelectShader }) => {
  const [pickerTab, setPickerTab] = React.useState<"effects" | "shaders">(
    "effects",
  );
  const [query, setQuery] = React.useState("");
  const shaderDefs = useMemo(
    () =>
      getMotionShaderEffectDefs().map((def) => ({
        ...def,
        name: localizeVideoShaderName(def.id, def.name),
        params: def.params.map((param) => ({
          ...param,
          label: localizeVideoEffectParamLabel(param.label),
        })),
      })),
    [],
  );
  const visibleEffects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return EDITOR_EFFECT_PREVIEWS;
    return EDITOR_EFFECT_PREVIEWS.filter((effect) =>
      `${effect.label} ${effect.description} ${effect.category}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);
  return (
    <Popover
      placement="below"
      alignment="end"
      width={430}
      label="添加视频效果"
      content={
        <div className="w-[430px] max-w-[calc(100vw-32px)] space-y-2.5 p-2.5">
          <div className="flex items-center gap-1 rounded-[8px] bg-bg-2 p-1">
            {([
              ["effects", `效果 · ${EDITOR_EFFECT_PREVIEWS.length}`],
              ["shaders", `材质效果 · ${shaderDefs.length}`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={pickerTab === id}
                onClick={() => setPickerTab(id)}
                className={`h-7 flex-1 rounded-[6px] px-2 text-[11px] font-semibold transition-colors ${
                  pickerTab === id
                    ? "bg-bg-1 text-fg shadow-sm"
                    : "text-fg-3 hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {pickerTab === "effects" ? (
            <>
              <label className="relative block">
                <Search
                  size={13}
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索视频效果"
                  aria-label="搜索视频效果"
                  className="h-8 w-full rounded-[7px] border border-border bg-bg-2 pl-8 pr-2.5 text-xs text-fg outline-none placeholder:text-fg-4 focus:border-accent"
                />
              </label>
              <div className="max-h-[390px] space-y-3 overflow-y-auto pr-1">
                {EDITOR_EFFECT_CATEGORIES.map((category) => {
                  const effects = visibleEffects.filter(
                    (effect) => effect.category === category,
                  );
                  if (effects.length === 0) return null;
                  return (
                    <section
                      key={category}
                      aria-label={`${VIDEO_EFFECT_CATEGORY_LABELS[category] ?? category}效果`}
                    >
                      <div className="mb-1.5 flex items-center justify-between px-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-fg-4">
                          {VIDEO_EFFECT_CATEGORY_LABELS[category] ?? category}
                        </span>
                        <span className="text-[9px] tabular-nums text-fg-4">
                          {effects.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {effects.map((effect) => (
                          <VisualEffectPreview
                            key={effect.id ?? effect.type}
                            def={effect}
                            onSelect={onSelect}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
                {visibleEffects.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-border px-3 py-8 text-center text-[11px] text-fg-4">
                    没有匹配“{query}”的效果。
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <ShaderPreviewBrowser
              defs={shaderDefs}
              onSelect={onSelectShader}
              sample="effect"
              label="材质效果预览"
            />
          )}
        </div>
      }
    >
      <Button
        label="添加效果"
        variant="secondary"
        size="sm"
        endContent={<ChevronDown size={12} className="text-fg-3" aria-hidden />}
        className="w-full justify-center border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
      />
    </Popover>
  );
};

/**
 * VideoEffectsSection Props
 */
interface VideoEffectsSectionProps {
  clipId: string;
}

/**
 * VideoEffectsSection Component
 *
 * - 1.1: Display sliders for brightness, contrast, saturation
 * - 1.2: Apply video effects within 200ms
 * - 2.1: Blur effect with radius control
 * - 2.2: Sharpen effect with amount and radius
 * - 2.3: Vignette effect with amount, midpoint, feather
 * - 2.4: Grain effect with amount and size
 */
export const VideoEffectsSection: React.FC<VideoEffectsSectionProps> = ({
  clipId,
}) => {
  const {
    getVideoEffects,
    addVideoEffect,
    duplicateVideoEffect,
    replaceVideoEffects,
    updateVideoEffect,
    removeVideoEffect,
    toggleVideoEffect,
    reorderVideoEffects,
  } = useProjectStore();

  // Subscribe to project.modifiedAt to trigger re-renders when effects change
  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);
  const [hasStackClipboard, setHasStackClipboard] = React.useState(
    hasVideoEffectStackClipboard(),
  );

  const effects = useMemo(
    () => getVideoEffects(clipId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipId, getVideoEffects, modifiedAt],
  );

  const handleAddEffect = useCallback(
    (def: EditorEffectPreviewDef) => {
      addVideoEffect(clipId, def.type, def.params);
    },
    [clipId, addVideoEffect],
  );

  const handleAddShaderEffect = useCallback(
    (shaderId: string) => {
      const def = getMotionShaderDef(shaderId);
      if (!def || def.category !== "effect") return;
      addVideoEffect(clipId, "shader", {
        shaderId,
        ...defaultMotionShaderParams(def),
      });
    },
    [clipId, addVideoEffect],
  );

  const handleUpdateEffect = useCallback(
    (effectId: string, params: Record<string, unknown>) => {
      updateVideoEffect(clipId, effectId, params);
    },
    [clipId, updateVideoEffect],
  );

  const handleToggleEffect = useCallback(
    (effectId: string, enabled: boolean) => {
      toggleVideoEffect(clipId, effectId, enabled);
    },
    [clipId, toggleVideoEffect],
  );

  const handleRemoveEffect = useCallback(
    (effectId: string) => {
      removeVideoEffect(clipId, effectId);
    },
    [clipId, removeVideoEffect],
  );

  const handleDuplicateEffect = useCallback(
    (effectId: string) => {
      void duplicateVideoEffect(clipId, effectId);
    },
    [clipId, duplicateVideoEffect],
  );

  const handleCopyStack = useCallback(() => {
    copyVideoEffectStack(effects);
    setHasStackClipboard(true);
  }, [effects]);

  const handlePasteStack = useCallback(
    (mode: "append" | "replace") => {
      const copies = cloneVideoEffectStackWithFreshIds();
      if (!copies) return;
      void replaceVideoEffects(
        clipId,
        mode === "replace" ? copies : [...effects, ...copies],
      );
    },
    [clipId, effects, replaceVideoEffects],
  );

  const handleClearStack = useCallback(() => {
    void replaceVideoEffects(clipId, []);
  }, [clipId, replaceVideoEffects]);

  const handleMoveEffect = useCallback(
    (effectId: string, delta: -1 | 1) => {
      const sourceIndex = effects.findIndex((effect) => effect.id === effectId);
      const targetIndex = sourceIndex + delta;
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= effects.length
      ) {
        return;
      }
      const nextIds = effects.map((effect) => effect.id);
      [nextIds[sourceIndex], nextIds[targetIndex]] = [
        nextIds[targetIndex]!,
        nextIds[sourceIndex]!,
      ];
      reorderVideoEffects(clipId, nextIds);
    },
    [clipId, effects, reorderVideoEffects],
  );

  const handleDropEffect = useCallback(
    (sourceEffectId: string, targetEffectId: string) => {
      if (sourceEffectId === targetEffectId) return;
      const sourceIndex = effects.findIndex(
        (effect) => effect.id === sourceEffectId,
      );
      const targetIndex = effects.findIndex(
        (effect) => effect.id === targetEffectId,
      );
      if (sourceIndex < 0 || targetIndex < 0) return;
      const nextIds = effects.map((effect) => effect.id);
      const [moved] = nextIds.splice(sourceIndex, 1);
      if (!moved) return;
      nextIds.splice(targetIndex, 0, moved);
      reorderVideoEffects(clipId, nextIds);
    },
    [clipId, effects, reorderVideoEffects],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          label="复制效果堆栈"
          variant="secondary"
          size="sm"
          isDisabled={effects.length === 0}
          onClick={handleCopyStack}
        />
        <Button
          label="粘贴效果堆栈"
          variant="secondary"
          size="sm"
          isDisabled={!hasStackClipboard}
          onClick={() => handlePasteStack("append")}
        />
        <Button
          label="粘贴并替换效果"
          variant="secondary"
          size="sm"
          isDisabled={!hasStackClipboard}
          onClick={() => handlePasteStack("replace")}
        />
        <Button
          label="清除效果堆栈"
          variant="secondary"
          size="sm"
          isDisabled={effects.length === 0}
          onClick={handleClearStack}
        />
      </div>
      {effects.length === 0 ? (
        <Text
          type="supporting"
          color="secondary"
          display="block"
          className="py-2 text-center text-[10px]"
        >
          尚未应用效果
        </Text>
      ) : (
        <div className="space-y-2">
          {effects.map((effect, index) => (
            <EffectItem
              key={effect.id}
              effect={effect}
              onUpdate={handleUpdateEffect}
              onToggle={handleToggleEffect}
              onRemove={handleRemoveEffect}
              onDuplicate={handleDuplicateEffect}
              onMove={handleMoveEffect}
              onDropEffect={handleDropEffect}
              canMoveUp={index > 0}
              canMoveDown={index < effects.length - 1}
            />
          ))}
        </div>
      )}
      <EffectTypeSelector
        onSelect={handleAddEffect}
        onSelectShader={handleAddShaderEffect}
      />
    </div>
  );
};

export default VideoEffectsSection;
