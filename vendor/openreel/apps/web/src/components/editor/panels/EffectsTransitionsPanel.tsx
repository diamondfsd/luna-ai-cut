import React, { useCallback, useMemo, useState } from "react";
import { Search } from "@/icons/lucide-compat";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import type {
  VideoEffectType,
} from "../../../bridges/effects-bridge";
import type { Clip, TransitionType } from "@openreel/core";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { serializeEditorEffectDropPayload } from "../timeline/effect-drop";

// ─── Effect & Transition catalogs ──────────────────────────────────
// Each item ships with a small CSS recipe used to animate the live
// preview thumbnail. The thumbnail itself comes from the user's
// currently-selected clip when available, falling back to a gradient.

export type EffectCategory =
  | "Basic"
  | "Color"
  | "Blur"
  | "Creative"
  | "Stylize";
type EffectCategoryFilter = "All" | EffectCategory;

export interface EditorEffectPreviewDef {
  id?: string;
  type: VideoEffectType;
  label: string;
  description: string;
  category: EffectCategory;
  params?: Record<string, unknown>;
  /** Returns a CSS filter / transform / opacity string for the preview
   *  given an animation progress p in [0, 1] (or a paused 0.5 hover state). */
  previewStyle: (p: number) => React.CSSProperties;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const EDITOR_EFFECT_PREVIEWS: EditorEffectPreviewDef[] = [
  {
    type: "brightness",
    label: "亮度",
    description: "提升中间调和高光",
    category: "Basic",
    previewStyle: (p) => ({ filter: `brightness(${lerp(0.9, 1.6, p)})` }),
  },
  {
    type: "contrast",
    label: "对比度",
    description: "增强阴影和高光",
    category: "Basic",
    previewStyle: (p) => ({ filter: `contrast(${lerp(0.8, 1.8, p)})` }),
  },
  {
    type: "saturation",
    label: "饱和度",
    description: "增强或降低色彩强度",
    category: "Basic",
    previewStyle: (p) => ({ filter: `saturate(${lerp(0.5, 2.0, p)})` }),
  },
  {
    type: "grayscale",
    label: "灰度",
    description: "转为单色",
    category: "Color",
    previewStyle: (p) => ({ filter: `grayscale(${p})` }),
  },
  {
    type: "sepia",
    label: "棕褐色",
    description: "温暖的复古色调",
    category: "Color",
    previewStyle: (p) => ({ filter: `sepia(${p})` }),
  },
  {
    type: "invert",
    label: "反相",
    description: "反转图像颜色",
    category: "Creative",
    previewStyle: (p) => ({ filter: `invert(${p})` }),
  },
  {
    type: "tonal",
    label: "色调平衡",
    description: "调整阴影、中间调和高光",
    category: "Basic",
    previewStyle: (p) => ({
      filter: `brightness(${lerp(0.92, 1.14, p)}) contrast(${lerp(0.9, 1.35, p)})`,
    }),
  },
  {
    type: "temperature",
    label: "色温",
    description: "冷暖色偏移",
    category: "Color",
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.6, p)}) hue-rotate(${lerp(-12, 12, p)}deg)`,
    }),
  },
  {
    type: "tint",
    label: "色调偏移",
    description: "洋红与绿色偏移",
    category: "Color",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 60, p)}deg)`,
    }),
  },
  {
    type: "hue",
    label: "色相",
    description: "旋转色轮",
    category: "Color",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 360, p)}deg)`,
    }),
  },
  {
    type: "blur",
    label: "模糊",
    description: "柔和的高斯虚化",
    category: "Blur",
    previewStyle: (p) => ({ filter: `blur(${lerp(0, 6, p)}px)` }),
  },
  {
    type: "motion-blur",
    label: "动态模糊",
    description: "方向性拖影",
    category: "Blur",
    previewStyle: (p) => ({
      filter: `blur(${lerp(0, 3, p)}px)`,
      transform: `translateX(${lerp(0, 6, p)}px)`,
    }),
  },
  {
    type: "radial-blur",
    label: "径向模糊",
    description: "缩放式径向运动",
    category: "Blur",
    previewStyle: (p) => ({
      filter: `blur(${lerp(0, 4, p)}px)`,
      transform: `scale(${lerp(1, 1.12, p)})`,
    }),
  },
  {
    type: "sharpen",
    label: "锐化",
    description: "增强边缘清晰度",
    category: "Creative",
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.4, p)}) brightness(${lerp(1, 1.05, p)})`,
    }),
  },
  {
    type: "vignette",
    label: "暗角",
    description: "加深边缘以突出主体",
    category: "Creative",
    previewStyle: (p) => ({
      boxShadow: `inset 0 0 ${lerp(0, 50, p)}px ${lerp(0, 25, p)}px rgba(0,0,0,0.65)`,
    }),
  },
  {
    type: "grain",
    label: "胶片颗粒",
    description: "模拟胶片纹理",
    category: "Creative",
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.1, p)})`,
      opacity: lerp(1, 0.92, p),
    }),
  },
  {
    type: "shadow",
    label: "投影",
    description: "添加柔和投影",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `drop-shadow(${lerp(0, 4, p)}px ${lerp(0, 4, p)}px ${lerp(0, 8, p)}px rgba(0,0,0,0.6))`,
    }),
  },
  {
    type: "glow",
    label: "光晕",
    description: "添加明亮外发光",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 1.15, p)}) drop-shadow(0 0 ${lerp(0, 12, p)}px var(--accent))`,
    }),
  },
  {
    type: "chromatic-aberration",
    label: "色差",
    description: "RGB 通道错位",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 6, p)}deg)`,
      textShadow: `${lerp(0, 2, p)}px 0 red, ${lerp(0, -2, p)}px 0 cyan`,
    }),
  },
  {
    type: "chromaKey",
    label: "色键",
    description: "移除绿幕或蓝幕背景",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 18, p)}deg) saturate(${lerp(1, 1.35, p)})`,
      boxShadow: `inset 0 0 0 ${lerp(0, 5, p)}px rgba(34,197,94,.75)`,
    }),
  },
  {
    id: "cinematic-punch",
    type: "contrast",
    label: "电影感",
    description: "高对比度，适合强调画面的剪辑",
    category: "Basic",
    params: { value: 1.35 },
    previewStyle: (p) => ({ filter: `contrast(${lerp(1, 1.35, p)})` }),
  },
  {
    id: "golden-hour",
    type: "temperature",
    label: "黄金时刻",
    description: "温暖的阳光色调",
    category: "Color",
    params: { value: 35 },
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.48, p)}) saturate(${lerp(1, 1.22, p)})`,
    }),
  },
  {
    id: "soft-focus",
    type: "blur",
    label: "柔焦",
    description: "为人像和标题添加柔和扩散",
    category: "Blur",
    params: { radius: 12, type: "gaussian" },
    previewStyle: (p) => ({ filter: `blur(${lerp(0, 4, p)}px)` }),
  },
  {
    id: "dream-bloom",
    type: "glow",
    label: "梦幻光晕",
    description: "柔和的薰衣草色光晕和高光",
    category: "Stylize",
    params: { radius: 28, intensity: 1.25, color: "#c4b5fd" },
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 1.15, p)}) drop-shadow(0 0 ${lerp(0, 16, p)}px #c4b5fd)`,
    }),
  },
  {
    id: "retro-grain",
    type: "grain",
    label: "复古颗粒",
    description: "适合复古剪辑的细腻单色纹理",
    category: "Creative",
    params: { amount: 0.18, size: 0.7, roughness: 0.65, colored: false },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.12, p)}) grayscale(${lerp(0, 0.15, p)})`,
    }),
  },
  {
    id: "rgb-split",
    type: "chromatic-aberration",
    label: "RGB 分离",
    description: "强烈的通道分离数字效果",
    category: "Stylize",
    params: { amount: 12, angle: 0 },
    previewStyle: (p) => ({
      textShadow: `${lerp(0, 4, p)}px 0 red, ${lerp(0, -4, p)}px 0 cyan`,
    }),
  },
  {
    id: "shader-vhs",
    type: "shader",
    label: "VHS",
    description: "动态磁带抖动、颗粒和扫描线",
    category: "Stylize",
    params: { shaderId: "vhs", intensity: 0.75, scanlines: 0.4, jitter: 0.45 },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.2, p)}) saturate(${lerp(1, 0.82, p)})`,
      transform: `translateX(${Math.sin(p * Math.PI * 8) * 2}px)`,
      boxShadow: `inset ${lerp(0, 3, p)}px 0 rgba(255,0,80,.35), inset ${lerp(0, -3, p)}px 0 rgba(0,220,255,.35)`,
    }),
  },
  {
    id: "shader-posterize",
    type: "shader",
    label: "色调分离",
    description: "将画面压缩为醒目的图形色带",
    category: "Creative",
    params: { shaderId: "posterize", levels: 5, mix: 1 },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.65, p)}) saturate(${lerp(1, 1.35, p)})`,
    }),
  },
  {
    id: "shader-duotone",
    type: "shader",
    label: "双调",
    description: "将阴影和高光映射为两种自定义颜色",
    category: "Color",
    params: {
      shaderId: "duotone",
      shadowColor: "#11133f",
      highlightColor: "#ffca6b",
      mix: 0.9,
      contrast: 1.15,
    },
    previewStyle: (p) => ({
      filter: `grayscale(${p}) sepia(${p}) hue-rotate(${lerp(0, 330, p)}deg) saturate(${lerp(1, 2.2, p)})`,
    }),
  },
  {
    id: "shader-prism",
    type: "shader",
    label: "棱镜分离",
    description: "带可调偏移的方向性 RGB 折射",
    category: "Stylize",
    params: { shaderId: "prism", amount: 8, angle: 0, mix: 1 },
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 10, p)}deg)`,
      boxShadow: `inset ${lerp(0, 5, p)}px 0 rgba(255,40,90,.5), inset ${lerp(0, -5, p)}px 0 rgba(0,220,255,.5)`,
    }),
  },
  {
    id: "shader-fisheye",
    type: "shader",
    label: "鱼眼",
    description: "聚焦画面中心的弯曲镜头畸变",
    category: "Creative",
    params: { shaderId: "fisheye", strength: 0.55, radius: 0.8 },
    previewStyle: (p) => ({
      transform: `scale(${lerp(1, 1.12, p)})`,
      borderRadius: `${lerp(0, 24, p)}%`,
    }),
  },
  {
    id: "shader-wave-warp",
    type: "shader",
    label: "波浪扭曲",
    description: "动态水平液体畸变",
    category: "Creative",
    params: { shaderId: "wave-warp", amplitude: 0.025, frequency: 5, speed: 1.5 },
    previewStyle: (p) => ({
      transform: `translateX(${Math.sin(p * Math.PI * 2) * 5}px) skewY(${Math.sin(p * Math.PI * 2) * 1.5}deg)`,
    }),
  },
  {
    id: "shader-scanlines",
    type: "shader",
    label: "扫描线",
    description: "动态 CRT 扫描线纹理",
    category: "Stylize",
    params: { shaderId: "scanlines", density: 360, intensity: 0.3, speed: 0.2 },
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 0.82, p)}) contrast(${lerp(1, 1.25, p)})`,
      backgroundImage:
        "repeating-linear-gradient(0deg,rgba(0,0,0,.35) 0 1px,transparent 1px 3px)",
    }),
  },
  {
    id: "shader-edge-glow",
    type: "shader",
    label: "边缘发光",
    description: "沿图像细节勾勒霓虹色",
    category: "Stylize",
    params: { shaderId: "edge-glow", strength: 4, radius: 1.5, color: "#4de8ff" },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.45, p)}) drop-shadow(0 0 ${lerp(0, 9, p)}px #4de8ff)`,
    }),
  },
];

export const EDITOR_EFFECT_CATEGORIES: EffectCategory[] = [
  "Basic",
  "Color",
  "Blur",
  "Creative",
  "Stylize",
];

interface TransitionDef {
  id?: string;
  type: TransitionType;
  label: string;
  description: string;
  params?: Record<string, unknown>;
  /** Render the preview as two colored panels animated according to
   *  this transition's progress p in [0, 1]. */
  renderPreview: (
    p: number,
    thumbUrl: string | null,
  ) => React.ReactElement;
}

type TransitionCategory = "Dissolves" | "Wipes" | "Movement" | "Stylized";
type TransitionCategoryFilter = "All" | TransitionCategory;

const TRANSITION_CATEGORIES: TransitionCategory[] = [
  "Dissolves",
  "Wipes",
  "Movement",
  "Stylized",
];

const CATEGORY_LABELS: Record<string, string> = {
  All: "全部",
  Basic: "基础",
  Color: "颜色",
  Blur: "模糊",
  Creative: "创意",
  Stylize: "风格",
  Dissolves: "溶解",
  Wipes: "擦除",
  Movement: "运动",
  Stylized: "风格化",
};

const getCategoryLabel = (category: string): string =>
  CATEGORY_LABELS[category] ?? category;

const getDirectionLabel = (direction: string): string =>
  ({
    left: "左",
    right: "右",
    up: "上",
    down: "下",
    horizontal: "水平",
    vertical: "垂直",
    diagonal: "对角",
  }[direction] ?? direction);

const transitionCategory = (type: TransitionType): TransitionCategory => {
  if (type === "crossfade" || type === "dipToBlack" || type === "dipToWhite") {
    return "Dissolves";
  }
  if (
    type === "wipe" ||
    type === "circleReveal" ||
    type === "radialWipe" ||
    type === "blinds" ||
    type === "diamondReveal" ||
    type === "splitReveal" ||
    type === "mosaic"
  ) {
    return "Wipes";
  }
  if (
    type === "slide" ||
    type === "push" ||
    type === "whipPan" ||
    type === "spin" ||
    type === "flip" ||
    type === "pageTurn"
  ) {
    return "Movement";
  }
  return "Stylized";
};

const renderThumb = (
  thumbUrl: string | null,
  style: React.CSSProperties,
  tint: string,
): React.ReactElement => (
  <div className="absolute inset-0 overflow-hidden" style={style}>
    {thumbUrl ? (
      <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
    ) : (
      <div
        className="w-full h-full"
        style={{
          background: `linear-gradient(135deg, ${tint}, oklch(0.45 0.12 200))`,
        }}
      />
    )}
  </div>
);

const TRANSITIONS: TransitionDef[] = [
  {
    type: "crossfade",
    label: "交叉淡化",
    description: "平滑的不透明度混合",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "dipToBlack",
    label: "淡入黑场",
    description: "通过黑场淡化",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: p < 0.5 ? 1 - p * 2 : 0 }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p >= 0.5 ? (p - 0.5) * 2 : 0 }, "oklch(0.72 0.16 162)")}
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: p < 0.5 ? p * 2 : (1 - p) * 2 }}
        />
      </>
    ),
  },
  {
    type: "dipToWhite",
    label: "淡入白场",
    description: "通过白场淡化",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: p < 0.5 ? 1 - p * 2 : 0 }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p >= 0.5 ? (p - 0.5) * 2 : 0 }, "oklch(0.72 0.16 162)")}
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{ opacity: p < 0.5 ? p * 2 : (1 - p) * 2 }}
        />
      </>
    ),
  },
  {
    type: "wipe",
    label: "擦除",
    description: "硬边横扫画面",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { clipPath: `inset(0 ${p * 100}% 0 0)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  ...([
    { id: "wipe-left", label: "向左擦除", direction: "left" },
    { id: "wipe-right", label: "向右擦除", direction: "right" },
    { id: "wipe-up", label: "向上擦除", direction: "up" },
    { id: "wipe-down", label: "向下擦除", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "wipe",
    label,
    description: `从${getDirectionLabel(direction)}侧展开`,
    params: { direction, softness: 0 },
    renderPreview: (p, thumb) => {
      const incomingClip =
        direction === "left"
          ? `inset(0 ${(1 - p) * 100}% 0 0)`
          : direction === "right"
            ? `inset(0 0 0 ${(1 - p) * 100}%)`
            : direction === "up"
              ? `inset(0 0 ${(1 - p) * 100}% 0)`
              : `inset(${(1 - p) * 100}% 0 0 0)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { clipPath: incomingClip },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  {
    type: "slide",
    label: "滑动",
    description: "新片段滑入",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { transform: `translateX(${-p * 100}%)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { transform: `translateX(${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  ...([
    { id: "slide-left", label: "向左滑动", direction: "left" },
    { id: "slide-right", label: "向右滑动", direction: "right" },
    { id: "slide-up", label: "向上滑动", direction: "up" },
    { id: "slide-down", label: "向下滑动", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "slide",
    label,
    description: `下一个片段向${getDirectionLabel(direction)}侧滑入`,
    params: { direction },
    renderPreview: (p, thumb) => {
      const transform =
        direction === "left"
          ? `translateX(${(1 - p) * 100}%)`
          : direction === "right"
            ? `translateX(${-(1 - p) * 100}%)`
            : direction === "up"
              ? `translateY(${(1 - p) * 100}%)`
              : `translateY(${-(1 - p) * 100}%)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { transform },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  {
    type: "push",
    label: "推移",
    description: "将当前片段推出画面",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { transform: `translateX(${-p * 100}%)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { transform: `translateX(${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "zoom",
    label: "缩放",
    description: "放大并淡化",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          { transform: `scale(${1 + p * 1.5})`, opacity: 1 - p },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          { transform: `scale(${1.5 - p * 0.5})`, opacity: p },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  {
    type: "circleReveal",
    label: "圆形展开",
    description: "从中心向外展开",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { clipPath: `circle(${p * 75}% at 50% 50%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "blur",
    label: "模糊溶解",
    description: "模糊当前片段并过渡到下一片段",
    renderPreview: (p, thumb) => {
      const b = Math.sin(p * Math.PI) * 6;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p, filter: `blur(${b}px)` }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p, filter: `blur(${b}px)` }, "oklch(0.72 0.16 162)")}
        </>
      );
    },
  },
  {
    type: "whipPan",
    label: "快速摇移",
    description: "快速带动态模糊的摇移",
    renderPreview: (p, thumb) => {
      const b = Math.sin(p * Math.PI) * 8;
      return (
        <>
          {renderThumb(
            thumb,
            { transform: `translateX(${-p * 100}%)`, filter: `blur(${b}px)` },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { transform: `translateX(${(1 - p) * 100}%)`, filter: `blur(${b}px)` },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "radialWipe",
    label: "径向擦除",
    description: "像时钟一样进行角度擦除",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            maskImage: `conic-gradient(from -90deg, #000 ${p * 360}deg, transparent 0deg)`,
            WebkitMaskImage: `conic-gradient(from -90deg, #000 ${p * 360}deg, transparent 0deg)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  {
    type: "pixelate",
    label: "像素化",
    description: "将切点变成块状像素马赛克",
    params: { maxPixelSize: 48 },
    renderPreview: (p, thumb) => {
      const block = 2 + Math.round(Math.sin(p * Math.PI) * 12);
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay"
            style={{
              backgroundImage:
                "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
              backgroundSize: `${block}px ${block}px`,
            }}
          />
        </>
      );
    },
  },
  {
    type: "glitch",
    label: "故障切换",
    description: "在切点产生数字切片位移",
    params: { intensity: 0.08, slices: 12 },
    renderPreview: (p, thumb) => {
      const amount = Math.sin(p * Math.PI) * 12;
      return (
        <>
          {renderThumb(
            thumb,
            {
              opacity: 1 - p * 0.65,
              transform: `translateX(${-amount}px)`,
              filter: `hue-rotate(${-amount * 2}deg)`,
            },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            {
              opacity: p,
              transform: `translateX(${amount}px)`,
              clipPath:
                "polygon(0 0,100% 0,100% 18%,0 18%,0 30%,100% 30%,100% 48%,0 48%,0 62%,100% 62%,100% 82%,0 82%)",
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "blinds",
    label: "百叶窗",
    description: "通过重复叶片展开下一镜头",
    params: { count: 8, direction: "vertical" },
    renderPreview: (p, thumb) => {
      const open = Math.max(0.5, p * 12);
      const mask = `repeating-linear-gradient(90deg,#000 0 ${open}px,transparent ${open}px 12px)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { maskImage: mask, WebkitMaskImage: mask },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "diamondReveal",
    label: "菱形展开",
    description: "从中心扩大的几何光圈",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            clipPath: `polygon(50% ${50 - p * 70}%, ${50 + p * 70}% 50%, 50% ${50 + p * 70}%, ${50 - p * 70}% 50%)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  ...([
    { id: "spin-clockwise", label: "顺时针旋转", rotations: 1 },
    { id: "spin-counter", label: "逆时针旋转", rotations: -1 },
  ] as const).map<TransitionDef>(({ id, label, rotations }) => ({
    id,
    type: "spin",
    label,
    description: "旋转缩放转场，平滑衔接",
    params: { rotations },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          {
            opacity: 1 - p,
            transform: `rotate(${rotations * p * 360}deg) scale(${1 - p * 0.75})`,
          },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          {
            opacity: p,
            transform: `rotate(${rotations * (p - 1) * 360}deg) scale(${0.25 + p * 0.75})`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  ...([
    { id: "flip-horizontal", label: "水平翻转", axis: "horizontal" },
    { id: "flip-vertical", label: "垂直翻转", axis: "vertical" },
  ] as const).map<TransitionDef>(({ id, label, axis }) => ({
    id,
    type: "flip",
    label,
    description: `镜头间的卡片式${getDirectionLabel(axis)}翻转`,
    params: { axis },
    renderPreview: (p, thumb) => {
      const firstHalf = p < 0.5;
      const phase = firstHalf ? 1 - p * 2 : (p - 0.5) * 2;
      const transform =
        axis === "horizontal" ? `scaleX(${phase})` : `scaleY(${phase})`;
      return renderThumb(
        thumb,
        { transform },
        firstHalf ? "oklch(0.55 0.14 295)" : "oklch(0.72 0.16 162)",
      );
    },
  })),
  ...([
    { id: "split-horizontal", label: "水平分割", orientation: "horizontal" },
    { id: "split-vertical", label: "垂直分割", orientation: "vertical" },
  ] as const).map<TransitionDef>(({ id, label, orientation }) => ({
    id,
    type: "splitReveal",
    label,
    description: `从${orientation === "horizontal" ? "中线" : "中间"}向外展开下一镜头`,
    params: { orientation },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            clipPath:
              orientation === "horizontal"
                ? `inset(0 ${50 - p * 50}% 0 ${50 - p * 50}%)`
                : `inset(${50 - p * 50}% 0 ${50 - p * 50}% 0)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  {
    id: "flash-cut",
    type: "flash",
    label: "闪白切换",
    description: "高能量白色闪光",
    params: { intensity: 1 },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
        <div
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ opacity: Math.sin(p * Math.PI) }}
        />
      </>
    ),
  },
  ...([
    {
      id: "film-burn",
      label: "胶片灼烧",
      description: "温暖的模拟漏光",
      intensity: 1,
      warmth: 0.75,
      gradient:
        "linear-gradient(110deg, rgb(255 40 0), rgb(255 170 20) 48%, rgb(255 245 210))",
    },
    {
      id: "film-burn-red",
      label: "红色胶片灼烧",
      description: "戏剧化剪辑的浓郁红橙光晕",
      intensity: 1.3,
      warmth: 1,
      gradient:
        "linear-gradient(105deg, rgb(125 0 0), rgb(255 35 0) 45%, rgb(255 210 80))",
    },
    {
      id: "light-leak-cool",
      label: "冷色漏光",
      description: "蓝白色光学漏光",
      intensity: 0.9,
      warmth: 0,
      gradient:
        "linear-gradient(110deg, rgb(15 65 255), rgb(65 220 255) 48%, rgb(245 250 255))",
    },
  ] as const).map<TransitionDef>(
    ({ id, label, description, intensity, warmth, gradient }) => ({
      id,
      type: "filmBurn",
      label,
      description,
      params: { intensity, warmth },
      renderPreview: (p, thumb) => {
      const burn = Math.sin(p * Math.PI);
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: burn,
              background: gradient,
              mixBlendMode: "screen",
            }}
          />
        </>
      );
    },
    }),
  ),
  {
    type: "mosaic",
    label: "马赛克展开",
    description: "以打乱的图案拼合下一镜头",
    params: { tiles: 8, randomness: 0.85 },
    renderPreview: (p, thumb) => {
      const tileSize = 12;
      const cutoff = Math.round(p * 100);
      const mask = `linear-gradient(135deg, #000 ${cutoff}%, transparent ${cutoff + 18}%)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            {
              maskImage: mask,
              WebkitMaskImage: mask,
              backgroundSize: `${tileSize}px ${tileSize}px`,
              imageRendering: "pixelated",
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "ripple",
    label: "波纹",
    description: "流动波浪使切点两侧画面变形",
    params: { amplitude: 0.04, waves: 3 },
    renderPreview: (p, thumb) => {
      const wave = Math.sin(p * Math.PI) * 6;
      return (
        <>
          {renderThumb(
            thumb,
            { opacity: 1 - p, transform: `translateX(${-wave}px) skewY(${wave * 0.25}deg)` },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { opacity: p, transform: `translateX(${wave}px) skewY(${-wave * 0.25}deg)` },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  ...([
    { id: "page-turn-left", label: "向左翻页", direction: "left" },
    { id: "page-turn-right", label: "向右翻页", direction: "right" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "pageTurn",
    label,
    description: `将当前镜头向${getDirectionLabel(direction)}侧折叠`,
    params: { direction, shadow: 0.55 },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.72 0.16 162)")}
        {renderThumb(
          thumb,
          {
            transform: `scaleX(${1 - p})`,
            transformOrigin: direction === "left" ? "left center" : "right center",
            filter: `brightness(${1 - Math.sin(p * Math.PI) * 0.25})`,
          },
          "oklch(0.55 0.14 295)",
        )}
      </>
    ),
  })),
  {
    type: "colorSplit",
    label: "色彩分离",
    description: "剪辑点出现棱彩通道残影",
    params: { maxOffset: 18, angle: 0 },
    renderPreview: (p, thumb) => {
      const offset = Math.sin(p * Math.PI) * 7;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              transform: `translateX(${offset}px)`,
              background: "linear-gradient(90deg,rgba(255,0,80,.5),transparent 45%,rgba(0,220,255,.55))",
              opacity: Math.sin(p * Math.PI) * 0.7,
            }}
          />
        </>
      );
    },
  },
  ...([
    {
      id: "crossfade-linear",
      label: "线性溶解",
      description: "匀速不透明度混合",
      curve: "linear",
    },
    {
      id: "crossfade-ease-in",
      label: "缓入溶解",
      description: "溶解向切点逐渐加速",
      curve: "ease-in",
    },
    {
      id: "crossfade-ease-out",
      label: "缓出溶解",
      description: "溶解在切点后逐渐平稳",
      curve: "ease-out",
    },
  ] as const).map<TransitionDef>(({ id, label, description, curve }) => ({
    id,
    type: "crossfade",
    label,
    description,
    params: { curve },
    renderPreview: (p, thumb) => {
      const eased =
        curve === "ease-in"
          ? p * p
          : curve === "ease-out"
            ? p * (2 - p)
            : p;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - eased }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: eased }, "oklch(0.72 0.16 162)")}
        </>
      );
    },
  })),
  ...([
    {
      id: "wipe-soft-left",
      label: "柔和向左擦除",
      direction: "left",
      softness: 0.45,
    },
    {
      id: "wipe-soft-right",
      label: "柔和向右擦除",
      direction: "right",
      softness: 0.45,
    },
    {
      id: "wipe-diagonal",
      label: "对角擦除",
      direction: "diagonal",
      softness: 0,
    },
  ] as const).map<TransitionDef>(({ id, label, direction, softness }) => ({
    id,
    type: "wipe",
    label,
    description:
      direction === "diagonal"
        ? "从角落进行角度展开"
        : "带羽化的方向性展开",
    params: { direction, softness },
    renderPreview: (p, thumb) => {
      const clipPath =
        direction === "right"
          ? `inset(0 0 0 ${(1 - p) * 100}%)`
          : direction === "diagonal"
            ? `polygon(0 0, ${p * 200}% 0, 0 ${p * 200}%)`
            : `inset(0 ${(1 - p) * 100}% 0 0)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            {
              clipPath,
              filter: softness > 0 ? "blur(1.5px)" : undefined,
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  ...([
    { id: "push-left", label: "向左推移", direction: "left" },
    { id: "push-right", label: "向右推移", direction: "right" },
    { id: "push-up", label: "向上推移", direction: "up" },
    { id: "push-down", label: "向下推移", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "push",
    label,
    description: `两个片段同时向${getDirectionLabel(direction)}侧移动`,
    params: { direction },
    renderPreview: (p, thumb) => {
      const outgoingTransform =
        direction === "left"
          ? `translateX(${-p * 100}%)`
          : direction === "right"
            ? `translateX(${p * 100}%)`
            : direction === "up"
              ? `translateY(${-p * 100}%)`
              : `translateY(${p * 100}%)`;
      const incomingTransform =
        direction === "left"
          ? `translateX(${(1 - p) * 100}%)`
          : direction === "right"
            ? `translateX(${-(1 - p) * 100}%)`
            : direction === "up"
              ? `translateY(${(1 - p) * 100}%)`
              : `translateY(${-(1 - p) * 100}%)`;
      return (
        <>
          {renderThumb(
            thumb,
            { transform: outgoingTransform },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { transform: incomingTransform },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  ...([
    {
      id: "zoom-top-left",
      label: "缩放至左上",
      center: { x: 0.15, y: 0.15 },
    },
    {
      id: "zoom-bottom-right",
      label: "缩放至右下",
      center: { x: 0.85, y: 0.85 },
    },
    {
      id: "zoom-punch",
      label: "冲击缩放",
      center: { x: 0.5, y: 0.5 },
    },
  ] as const).map<TransitionDef>(({ id, label, center }) => ({
    id,
    type: "zoom",
    label,
    description: "聚焦缩放并淡化",
    params: { scale: id === "zoom-punch" ? 3 : 2, center },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          {
            opacity: 1 - p,
            transform: `scale(${1 + p * (id === "zoom-punch" ? 2 : 1)})`,
            transformOrigin: `${center.x * 100}% ${center.y * 100}%`,
          },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          { opacity: p },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  ...([
    { id: "whip-left", label: "快速向左摇移", direction: "left" },
    { id: "whip-right", label: "快速向右摇移", direction: "right" },
    { id: "whip-up", label: "快速向上摇移", direction: "up" },
    { id: "whip-down", label: "快速向下摇移", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "whipPan",
    label,
    description: `带动态模糊向${getDirectionLabel(direction)}侧摇移`,
    params: { direction },
    renderPreview: (p, thumb) => {
      const axis = direction === "left" || direction === "right" ? "X" : "Y";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      const blur = Math.sin(p * Math.PI) * 8;
      return (
        <>
          {renderThumb(
            thumb,
            {
              transform: `translate${axis}(${sign * p * 100}%)`,
              filter: `blur(${blur}px)`,
            },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            {
              transform: `translate${axis}(${-sign * (1 - p) * 100}%)`,
              filter: `blur(${blur}px)`,
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
];

// ─── Drag payload helpers ──────────────────────────────────────────
export const EFFECT_DRAG_MIME = "application/x-openreel-effect";
export const TRANSITION_DRAG_MIME = "application/x-openreel-transition";

const PREVIEW_CYCLE_MS = 1800;

// ─── Cards ────────────────────────────────────────────────────────

const EffectCard: React.FC<{
  def: EditorEffectPreviewDef;
  thumbUrl: string | null;
  onApply: () => void;
}> = ({ def, thumbUrl, onApply }) => {
  const [progress, setProgress] = useState(0.72);
  const [isHover, setIsHover] = useState(false);
  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!isHover) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0.72);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % PREVIEW_CYCLE_MS;
      const t = elapsed / PREVIEW_CYCLE_MS;
      // Ping-pong so the effect intensifies then relaxes
      const eased = t < 0.5 ? t * 2 : (1 - t) * 2;
      setProgress(eased);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isHover]);

  const previewStyle = def.previewStyle(progress);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "copy";
      const payload = serializeEditorEffectDropPayload({
        effectType: def.type,
        effectParams: def.params,
      });
      e.dataTransfer.setData(EFFECT_DRAG_MIME, payload);
      // Fallback for browsers that don't surface custom MIME types
      e.dataTransfer.setData("text/plain", `effect:${def.type}`);
    },
    [def.params, def.type],
  );

  return (
    <ClickableCard
      label={`${def.label}。拖到时间线片段上应用，或双击应用到选中的片段。`}
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onApply}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      padding={0}
      variant="default"
      className="group relative flex flex-col items-stretch border border-border bg-bg-2 overflow-hidden text-left cursor-grab active:cursor-grabbing hover:border-accent transition-colors"
    >
      <div
        data-effect-preview={def.id ?? def.type}
        data-preview-progress={progress.toFixed(2)}
        className="relative aspect-video bg-bg-3 overflow-hidden"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={previewStyle}
            draggable={false}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.55 0.14 295), oklch(0.72 0.16 162))",
              ...previewStyle,
            }}
          />
        )}
        <Text className="absolute bottom-1 right-1 text-[8.5px] uppercase px-1.5 py-0.5 rounded bg-black/55 text-white/85 backdrop-blur-sm">
          {getCategoryLabel(def.category)}
        </Text>
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <Text type="supporting" weight="bold" display="block" maxLines={1} className="text-[10.5px] text-fg leading-tight">
          {def.label}
        </Text>
        <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9.5px] text-fg-muted leading-tight mt-0.5">
          {def.description}
        </Text>
      </div>
    </ClickableCard>
  );
};

const TransitionCard: React.FC<{
  def: TransitionDef;
  thumbUrl: string | null;
  onApply: () => void;
}> = ({ def, thumbUrl, onApply }) => {
  const [progress, setProgress] = useState(0);
  const [isHover, setIsHover] = useState(false);
  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!isHover) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % PREVIEW_CYCLE_MS;
      setProgress(elapsed / PREVIEW_CYCLE_MS);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isHover]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "copy";
      const payload = JSON.stringify({
        transitionType: def.type,
        transitionParams: def.params,
      });
      e.dataTransfer.setData(TRANSITION_DRAG_MIME, payload);
      e.dataTransfer.setData("text/plain", `transition:${def.type}`);
    },
    [def.params, def.type],
  );

  return (
    <ClickableCard
      label={`${def.label}。拖到片段边缘应用，或双击应用到选中的切点。`}
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onApply}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      padding={0}
      variant="default"
      className="group relative flex flex-col items-stretch border border-border bg-bg-2 overflow-hidden text-left cursor-grab active:cursor-grabbing hover:border-accent transition-colors"
    >
      <div className="relative aspect-video bg-bg-3 overflow-hidden">
        {def.renderPreview(progress, thumbUrl)}
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <Text type="supporting" weight="bold" display="block" maxLines={1} className="text-[10.5px] text-fg leading-tight">
          {def.label}
        </Text>
        <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9.5px] text-fg-muted leading-tight mt-0.5">
          {def.description}
        </Text>
      </div>
    </ClickableCard>
  );
};

// ─── Hook: thumbnail of the user's currently selected clip ────────

/**
 * Resolve the best available thumbnail URL from the user's current
 * selection. Falls back to the first video clip in the project, then
 * the first imported video, otherwise null (cards show gradients).
 */
const useCurrentClipThumbnail = (): string | null => {
  const project = useProjectStore((s) => s.project);
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);

  return useMemo(() => {
    const selectedIds = getSelectedClipIds();
    const tracks = project.timeline.tracks;
    const mediaItems = project.mediaLibrary.items;

    const findMediaForClipId = (clipId: string): string | null => {
      for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const item = mediaItems.find((m) => m.id === clip.mediaId);
          if (item?.thumbnailUrl) return item.thumbnailUrl;
        }
      }
      return null;
    };

    for (const id of selectedIds) {
      const thumb = findMediaForClipId(id);
      if (thumb) return thumb;
    }

    // Fallback 1: first clip with a thumbnail
    for (const track of tracks) {
      for (const clip of track.clips) {
        const item = mediaItems.find((m) => m.id === clip.mediaId);
        if (item?.thumbnailUrl) return item.thumbnailUrl;
      }
    }

    // Fallback 2: any media item with a thumbnail
    const firstWithThumb = mediaItems.find((m) => m.thumbnailUrl);
    return firstWithThumb?.thumbnailUrl ?? null;
  }, [project, getSelectedClipIds]);
};

// ─── Main panel ───────────────────────────────────────────────────

export const EffectsPanel: React.FC = () => {
  const thumbUrl = useCurrentClipThumbnail();
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);
  const addVideoEffect = useProjectStore((s) => s.addVideoEffect);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<EffectCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EDITOR_EFFECT_PREVIEWS.filter(
      (effect) =>
        (categoryFilter === "All" || effect.category === categoryFilter) &&
        (!q ||
          effect.label.toLowerCase().includes(q) ||
          effect.description.toLowerCase().includes(q) ||
          effect.category.toLowerCase().includes(q)),
    );
  }, [categoryFilter, query]);

  const applyToSelection = useCallback(
    async (def: EditorEffectPreviewDef) => {
      const selectedIds = getSelectedClipIds();
      if (selectedIds.length === 0) {
        toast.warning(
          "未选择片段",
          "将效果拖到时间线片段上，或选择片段后双击。",
        );
        return;
      }
      let appliedCount = 0;
      for (const id of selectedIds) {
        if (await addVideoEffect(id, def.type, def.params)) appliedCount += 1;
      }
      if (appliedCount === 0) {
        toast.error(
          "无法应用效果",
          "选中的图层不支持此效果。",
        );
        return;
      }
      toast.success(
        "效果已应用",
        `${def.label}已添加到 ${appliedCount} 个片段`,
      );
      if (appliedCount < selectedIds.length) {
        toast.warning(
          "部分图层已跳过",
          `${selectedIds.length - appliedCount} 个选中图层不支持此效果。`,
        );
      }
    },
    [getSelectedClipIds, addVideoEffect],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <ToolcraftTextInputControl
          label="搜索效果"
          isLabelHidden
          type="text"
          value={query}
          onChange={setQuery}
          placeholder="搜索效果"
          startIcon={<Search size={13} aria-hidden />}
          size="sm"
          width="100%"
        />
        <div
          className="mt-2 flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label="效果分类"
        >
          {(["All", ...EDITOR_EFFECT_CATEGORIES] as const).map((category) => {
            const count =
              category === "All"
                ? EDITOR_EFFECT_PREVIEWS.length
                : EDITOR_EFFECT_PREVIEWS.filter(
                    (effect) => effect.category === category,
                  ).length;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                  categoryFilter === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
                }`}
              >
                {getCategoryLabel(category)} {count}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pb-3 space-y-3">
          {EDITOR_EFFECT_CATEGORIES.filter(
            (category) =>
              categoryFilter === "All" || category === categoryFilter,
          ).map((cat) => {
            const items = filtered.filter((e) => e.category === cat);
            if (items.length === 0) return null;
            return (
              <section key={cat}>
                <Text type="supporting" color="secondary" weight="bold" display="block" className="text-[9.5px] uppercase mb-1.5">
                  {getCategoryLabel(cat)}
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((def) => (
                    <EffectCard
                      key={def.id ?? def.type}
                      def={def}
                      thumbUrl={thumbUrl}
                      onApply={() => applyToSelection(def)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10.5px] py-6">
              没有匹配“{query}”的效果。
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};

export const TransitionsPanel: React.FC = () => {
  const thumbUrl = useCurrentClipThumbnail();
  const project = useProjectStore((state) => state.project);
  const addClipTransition = useProjectStore(
    (state) => state.addClipTransition,
  );
  const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<TransitionCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TRANSITIONS.filter(
      (transition) => {
        const category = transitionCategory(transition.type);
        if (categoryFilter !== "All" && category !== categoryFilter) {
          return false;
        }
        return (
          !q ||
          transition.label.toLowerCase().includes(q) ||
          transition.description.toLowerCase().includes(q) ||
          category.toLowerCase().includes(q)
        );
      },
    );
  }, [categoryFilter, query]);

  const applyToSelectedCut = useCallback(
    async (def: TransitionDef) => {
      const selectedIds = new Set(getSelectedClipIds());
      const selectedCount = selectedIds.size;
      if (selectedCount === 0) {
        toast.warning(
          "未选择片段",
          "选择一个片段或两个相邻片段，然后双击转场。",
        );
        return;
      }

      let clipA: Clip | undefined;
      let clipB: Clip | undefined;
      for (const track of project.timeline.tracks) {
        const sorted = [...track.clips].sort(
          (first, second) => first.startTime - second.startTime,
        );
        if (selectedCount > 1) {
          for (let index = 0; index < sorted.length - 1; index += 1) {
            if (
              selectedIds.has(sorted[index].id) &&
              selectedIds.has(sorted[index + 1].id)
            ) {
              clipA = sorted[index];
              clipB = sorted[index + 1];
              break;
            }
          }
        } else {
          const selectedIndex = sorted.findIndex((clip) =>
            selectedIds.has(clip.id),
          );
          if (selectedIndex >= 0) {
            const selected = sorted[selectedIndex];
            const next = sorted[selectedIndex + 1];
            const previous = sorted[selectedIndex - 1];
            if (next) {
              clipA = selected;
              clipB = next;
            } else if (previous) {
              clipA = previous;
              clipB = selected;
            } else {
              clipA = selected;
              clipB = undefined;
            }
          }
        }
        if (clipA) break;
      }

      if (!clipA) {
        toast.warning(
          "没有可用的剪辑切点",
          "选中的片段必须位于同一条时间线轨道且彼此相邻。",
        );
        return;
      }

      const bridge = getTransitionBridge();
      if (!bridge.isInitialized()) {
        bridge.initialize(project.settings.width, project.settings.height);
      }
      const params = {
        ...bridge.getDefaultParams(def.type),
        ...def.params,
      };
      const result = clipB
        ? bridge.createTransition(clipA, clipB, def.type, 1, params)
        : bridge.createClipEdgeTransition(clipA, "out", def.type, 1, params);
      if (!result.success || !result.transitionId) {
        toast.error(
          "转场失败",
          result.error ?? "无法在选中的切点创建此转场。",
        );
        return;
      }
      const transition = bridge.getTransition(result.transitionId);
      if (!transition || !(await addClipTransition(transition))) {
        toast.error("转场失败", "无法保存转场。" );
        return;
      }
      toast.success(
        "转场已应用",
        `${def.label}已添加到选中的切点。`,
      );
    },
    [addClipTransition, getSelectedClipIds, project],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <ToolcraftTextInputControl
          label="搜索转场"
          isLabelHidden
          type="text"
          value={query}
          onChange={setQuery}
          placeholder="搜索转场"
          startIcon={<Search size={13} aria-hidden />}
          size="sm"
          width="100%"
        />
        <div
          className="mt-2 flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label="转场分类"
        >
          {(["All", ...TRANSITION_CATEGORIES] as const).map((category) => {
            const count =
              category === "All"
                ? TRANSITIONS.length
                : TRANSITIONS.filter(
                    (transition) =>
                      transitionCategory(transition.type) === category,
                  ).length;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                  categoryFilter === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
                }`}
              >
                {getCategoryLabel(category)} {count}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3 px-3 pb-3">
          {TRANSITION_CATEGORIES.filter(
            (category) =>
              categoryFilter === "All" || category === categoryFilter,
          ).map((category) => {
            const items = filtered.filter(
              (transition) => transitionCategory(transition.type) === category,
            );
            if (items.length === 0) return null;
            return (
              <section key={category}>
                <div className="mb-1.5 flex items-center justify-between">
                  <Text type="supporting" color="secondary" weight="bold" className="text-[9.5px] uppercase">
                    {getCategoryLabel(category)}
                  </Text>
                  <Text type="supporting" color="secondary" className="font-mono text-[9px]">
                    {items.length}
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((def) => (
                    <TransitionCard
                      key={def.id ?? `${def.type}-${def.label}`}
                      def={def}
                      thumbUrl={thumbUrl}
                      onApply={() => void applyToSelectedCut(def)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10.5px] py-6">
              没有匹配“{query}”的转场。
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};
