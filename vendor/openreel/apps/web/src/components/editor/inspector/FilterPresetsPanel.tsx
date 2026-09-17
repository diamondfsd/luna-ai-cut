import React, { useState, useCallback, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { Film, Camera, Moon, Palette, Wand2, Check } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import {
  FILTER_PRESETS,
  FILTER_CATEGORIES,
  getPresetsByCategory,
  type FilterPreset,
  type FilterCategory,
} from "@openreel/core";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  cinematic: Film,
  vintage: Camera,
  mood: Moon,
  color: Palette,
  stylized: Wand2,
};

const FILTER_CATEGORY_LABELS: Record<string, string> = {
  cinematic: "电影感",
  vintage: "复古",
  mood: "氛围",
  color: "色彩",
  stylized: "风格化",
};

const FILTER_EFFECT_LABELS: Record<FilterPreset["effects"][number]["type"], string> = {
  brightness: "亮度",
  contrast: "对比度",
  saturation: "饱和度",
  hue: "色相",
  blur: "模糊",
  sharpen: "锐化",
  vignette: "暗角",
  grain: "颗粒",
};

const FILTER_PRESET_LABELS: Record<string, { name: string; description: string }> = {
  "cinematic-teal-orange": { name: "电影青橙", description: "经典好莱坞调色" },
  "cinematic-noir": { name: "黑色电影", description: "高对比度黑白效果" },
  "cinematic-blockbuster": { name: "大片风格", description: "鲜明有力的好莱坞风格" },
  "vintage-70s": { name: "70 年代复古", description: "温暖褪色的 1970 年代风格" },
  "vintage-polaroid": { name: "宝丽来", description: "经典即时成像风格" },
  "vintage-vhs": { name: "VHS", description: "怀旧 VHS 磁带效果" },
  "vintage-sepia": { name: "棕褐色", description: "经典棕褐色调" },
  "mood-dreamy": { name: "梦幻", description: "柔和空灵的氛围" },
  "mood-moody": { name: "阴郁", description: "暗色氛围感" },
  "mood-golden-hour": { name: "黄金时刻", description: "温暖的日落光线" },
  "mood-cold": { name: "冷蓝", description: "清冷的冰蓝氛围" },
  "color-vibrant": { name: "鲜艳", description: "鲜明饱和的色彩" },
  "color-muted": { name: "柔和", description: "柔和低饱和的色调" },
  "color-bw-classic": { name: "黑白经典", description: "历久弥新的黑白效果" },
  "color-bw-high-contrast": { name: "黑白高对比", description: "戏剧化黑白效果" },
  "stylized-cyberpunk": { name: "赛博朋克", description: "霓虹灯未来风格" },
  "stylized-comic": { name: "漫画", description: "鲜明的漫画风格" },
  "stylized-soft-glow": { name: "柔和光晕", description: "浪漫柔焦效果" },
  "cinematic-bleach-bypass": { name: "高反差褪色", description: "粗粝低饱和高对比" },
  "cinematic-day-for-night": { name: "日景夜拍", description: "清冷的月光夜景风格" },
  "vintage-faded-film": { name: "褪色胶片", description: "提亮黑位的褪色效果" },
  "vintage-super8": { name: "Super 8", description: "温暖颗粒感的家庭电影风格" },
  "mood-sunset": { name: "日落", description: "温暖的金色光晕" },
  "mood-winter-chill": { name: "冬日冷调", description: "清冷明快的蓝色调" },
  "mood-dramatic": { name: "戏剧", description: "带暗角的阴郁高对比" },
  "color-pop": { name: "流行色", description: "鲜活有力的色彩" },
  "color-pastel": { name: "粉彩", description: "柔和通透的低对比色调" },
  "stylized-dreamscape": { name: "梦境", description: "朦胧发光的梦幻效果" },
  "stylized-hdr": { name: "清晰 HDR", description: "细节丰富且鲜明的清晰度" },
  "stylized-matrix": { name: "黑客帝国", description: "绿色调的数字反乌托邦风格" },
};

function filterPresetLocale(preset: FilterPreset) {
  return FILTER_PRESET_LABELS[preset.id] ?? {
    name: preset.name,
    description: preset.description,
  };
}

interface PresetCardProps {
  preset: FilterPreset;
  isApplied: boolean;
  onApply: () => void;
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isApplied,
  onApply,
}) => {
  const localized = filterPresetLocale(preset);
  return (
    <ClickableCard
      label={`预览并应用${localized.name}滤镜预设`}
      onClick={onApply}
      className={`relative w-full p-3 rounded-lg border transition-all text-left ${
        isApplied
          ? "border-primary bg-primary/10"
          : "border-border bg-bg-2 hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Text type="supporting" color="primary" weight="medium">
              {localized.name}
            </Text>
            {isApplied && <Check size={12} className="text-primary" />}
          </div>
          <Text type="supporting" color="secondary" display="block" className="mt-0.5 text-[9px]">
            {localized.description}
          </Text>
        </div>
      </div>
      <div className="mt-2 flex gap-1 flex-wrap">
        {preset.effects.slice(0, 3).map((effect, index) => (
          <Text
            key={index}
            type="supporting"
            color="secondary"
            className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            {FILTER_EFFECT_LABELS[effect.type] ?? effect.type}
          </Text>
        ))}
        {preset.effects.length > 3 && (
          <Text
            type="supporting"
            color="secondary"
            className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded text-fg-3"
          >
            +{preset.effects.length - 3}
          </Text>
        )}
      </div>
    </ClickableCard>
  );
};

interface FilterPresetsPanelProps {
  clipId?: string;
}

export const FilterPresetsPanel: React.FC<FilterPresetsPanelProps> = ({
  clipId,
}) => {
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const addVideoEffect = useProjectStore((state) => state.addVideoEffect);
  const getVideoEffects = useProjectStore((state) => state.getVideoEffects);
  const removeVideoEffect = useProjectStore((state) => state.removeVideoEffect);

  const [selectedCategory, setSelectedCategory] =
    useState<FilterCategory>("cinematic");
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);
  const [intensityValue, setIntensityValue] = useState(100);

  const targetClipId = clipId || selectedClipIds[0];
  const presets = useMemo(
    () => getPresetsByCategory(selectedCategory),
    [selectedCategory],
  );

  const handleApplyPreset = useCallback(
    async (preset: FilterPreset) => {
      if (!targetClipId) return;

      const existingEffects = getVideoEffects(targetClipId);
      for (const effect of existingEffects) {
        await removeVideoEffect(targetClipId, effect.id);
      }

      for (const filterEffect of preset.effects) {
        await addVideoEffect(
          targetClipId,
          filterEffect.type,
          filterEffect.params,
        );
      }

      setAppliedPresetId(preset.id);
      const localized = filterPresetLocale(preset);
      toast.success("滤镜已应用", `${localized.name} 预设已应用`);
    },
    [targetClipId, addVideoEffect, getVideoEffects, removeVideoEffect],
  );

  const handleClearEffects = useCallback(async () => {
    if (!targetClipId) return;

    const existingEffects = getVideoEffects(targetClipId);
    for (const effect of existingEffects) {
      await removeVideoEffect(targetClipId, effect.id);
    }

    setAppliedPresetId(null);
    toast.info("效果已清除");
  }, [targetClipId, getVideoEffects, removeVideoEffect]);

  if (!targetClipId) {
    return (
      <div className="p-4 text-center">
        <Palette size={24} className="mx-auto mb-2 text-fg-3" />
        <Text type="supporting" color="secondary">
          选择一个视频片段以应用滤镜
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Palette size={16} className="text-primary" />
        <div className="flex flex-col gap-0.5">
          <Text type="supporting" color="primary" weight="medium" display="block">
            滤镜预设
          </Text>
          <Text type="supporting" color="secondary" display="block" className="text-[9px]">
            一键调色
          </Text>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTER_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id] || Palette;
          return (
            <Button
              key={category.id}
              label={FILTER_CATEGORY_LABELS[category.id] ?? category.name}
              size="sm"
              variant={selectedCategory === category.id ? "primary" : "secondary"}
              icon={<Icon size={12} aria-hidden />}
              onClick={() => setSelectedCategory(category.id as FilterCategory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-bg-2 text-fg-2 hover:text-fg"
              }`}
            />
          );
        })}
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isApplied={appliedPresetId === preset.id}
            onApply={() => handleApplyPreset(preset)}
          />
        ))}
      </div>

      {appliedPresetId && (
        <Card variant="muted" padding={3} className="space-y-3">
          <PropertySlider
            label="强度"
            min={0}
            max={100}
            step={1}
            value={intensityValue}
            onChange={setIntensityValue}
            formatValue={(value) => `${value}%`}
          />
          <Button
            label="移除所有效果"
            size="sm"
            variant="destructive"
            onClick={handleClearEffects}
            className="w-full py-2 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg transition-colors"
          />
        </Card>
      )}

      <Text type="supporting" color="secondary" className="text-center text-[9px]">
        共 {FILTER_PRESETS.length} 个预设，分为 {FILTER_CATEGORIES.length} 类
      </Text>
    </div>
  );
};

export default FilterPresetsPanel;
