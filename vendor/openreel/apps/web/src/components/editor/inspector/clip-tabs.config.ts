import type { LucideIcon } from "@/icons/lucide-compat";
import { Move, Palette, Wand2, Volume2, Gauge, Film, Sparkles, Type } from "@/icons/lucide-compat";

export type InspectorTabId =
  | "transform"
  | "color"
  | "effects"
  | "audio"
  | "speed"
  | "animate"
  | "ai"
  | "style";

export type InspectorClipType =
  | "video"
  | "image"
  | "audio"
  | "text"
  | "shape"
  | "svg"
  | "sticker";

export interface InspectorTabDef {
  id: InspectorTabId;
  label: string;
  icon: LucideIcon;
}

export const TAB_DEFS: Record<InspectorTabId, InspectorTabDef> = {
  transform: { id: "transform", label: "变换", icon: Move },
  color: { id: "color", label: "调色", icon: Palette },
  effects: { id: "effects", label: "效果", icon: Wand2 },
  audio: { id: "audio", label: "音频", icon: Volume2 },
  speed: { id: "speed", label: "速度", icon: Gauge },
  animate: { id: "animate", label: "动效", icon: Film },
  ai: { id: "ai", label: "AI", icon: Sparkles },
  style: { id: "style", label: "样式", icon: Type },
};

const TABS_BY_CLIP_TYPE: Record<InspectorClipType, InspectorTabId[]> = {
  video: ["transform", "color", "effects", "audio", "speed", "animate", "ai"],
  image: ["transform", "color", "effects", "speed", "animate", "ai"],
  audio: ["audio", "ai"],
  text: ["transform", "style", "effects", "animate"],
  shape: ["transform", "style", "effects", "animate"],
  svg: ["transform", "style", "effects", "animate"],
  sticker: ["transform", "effects", "animate"],
};

export function getTabIdsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabId[] {
  if (!clipType) return [];
  return TABS_BY_CLIP_TYPE[clipType];
}

export function getTabsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabDef[] {
  return getTabIdsForClipType(clipType).map((id) => TAB_DEFS[id]);
}
