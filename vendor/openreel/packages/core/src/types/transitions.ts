import type { Vector2D, EasingFunction } from "./composition";

export type ClipTransitionType =
  | "dissolve"
  | "wipe"
  | "slide"
  | "push"
  | "zoom"
  | "iris"
  | "fade"
  | "blur"
  | "crossfade";

export type WipeDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "diagonal-tl"
  | "diagonal-tr"
  | "diagonal-bl"
  | "diagonal-br";

export type SlideDirection = "left" | "right" | "up" | "down";

export type IrisShape = "circle" | "rectangle" | "diamond" | "star";

export interface BaseTransition {
  id: string;
  type: ClipTransitionType;
  duration: number;
  easing: EasingFunction;
}

export interface DissolveTransition extends BaseTransition {
  type: "dissolve";
}

export interface FadeTransition extends BaseTransition {
  type: "fade";
  fadeToColor?: string;
}

export interface WipeTransition extends BaseTransition {
  type: "wipe";
  direction: WipeDirection;
  feather: number;
  angle?: number;
}

export interface SlideTransition extends BaseTransition {
  type: "slide";
  direction: SlideDirection;
  overlap: boolean;
}

export interface PushTransition extends BaseTransition {
  type: "push";
  direction: SlideDirection;
}

export interface ZoomTransition extends BaseTransition {
  type: "zoom";
  scale: number;
  origin: Vector2D;
  zoomIn: boolean;
}

export interface IrisTransition extends BaseTransition {
  type: "iris";
  shape: IrisShape;
  origin: Vector2D;
  openToClose: boolean;
}

export interface BlurTransition extends BaseTransition {
  type: "blur";
  blurAmount: number;
}

export interface CrossfadeTransition extends BaseTransition {
  type: "crossfade";
  audioFade: boolean;
  audioDuration?: number;
}

export type Transition =
  | DissolveTransition
  | FadeTransition
  | WipeTransition
  | SlideTransition
  | PushTransition
  | ZoomTransition
  | IrisTransition
  | BlurTransition
  | CrossfadeTransition;

export interface LayerTransition {
  layerId: string;
  inTransition?: Transition;
  outTransition?: Transition;
}

export interface ClipTransition {
  fromClipId: string;
  toClipId: string;
  transition: Transition;
  startTime: number;
}

type TransitionWithoutId =
  | Omit<DissolveTransition, "id">
  | Omit<FadeTransition, "id">
  | Omit<WipeTransition, "id">
  | Omit<SlideTransition, "id">
  | Omit<PushTransition, "id">
  | Omit<ZoomTransition, "id">
  | Omit<IrisTransition, "id">
  | Omit<BlurTransition, "id">
  | Omit<CrossfadeTransition, "id">;

export interface TransitionPreset {
  id: string;
  name: string;
  category: "basic" | "motion" | "blur" | "creative";
  transition: TransitionWithoutId;
  thumbnail?: string;
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
  {
    id: "dissolve-default",
    name: "Dissolve",
    category: "basic",
    transition: {
      type: "dissolve",
      duration: 500,
      easing: "linear",
    },
  },
  {
    id: "fade-black",
    name: "Fade to Black",
    category: "basic",
    transition: {
      type: "fade",
      duration: 500,
      easing: "ease-in-out",
      fadeToColor: "#000000",
    },
  },
  {
    id: "fade-white",
    name: "Fade to White",
    category: "basic",
    transition: {
      type: "fade",
      duration: 500,
      easing: "ease-in-out",
      fadeToColor: "#ffffff",
    },
  },
  {
    id: "wipe-left",
    name: "Wipe Left",
    category: "motion",
    transition: {
      type: "wipe",
      duration: 600,
      easing: "ease-in-out",
      direction: "left",
      feather: 0,
    },
  },
  {
    id: "wipe-right",
    name: "Wipe Right",
    category: "motion",
    transition: {
      type: "wipe",
      duration: 600,
      easing: "ease-in-out",
      direction: "right",
      feather: 0,
    },
  },
  {
    id: "wipe-up",
    name: "Wipe Up",
    category: "motion",
    transition: {
      type: "wipe",
      duration: 600,
      easing: "ease-in-out",
      direction: "up",
      feather: 0,
    },
  },
  {
    id: "wipe-down",
    name: "Wipe Down",
    category: "motion",
    transition: {
      type: "wipe",
      duration: 600,
      easing: "ease-in-out",
      direction: "down",
      feather: 0,
    },
  },
  {
    id: "wipe-soft",
    name: "Soft Wipe",
    category: "motion",
    transition: {
      type: "wipe",
      duration: 800,
      easing: "ease-in-out",
      direction: "right",
      feather: 50,
    },
  },
  {
    id: "slide-left",
    name: "Slide Left",
    category: "motion",
    transition: {
      type: "slide",
      duration: 500,
      easing: "ease-out",
      direction: "left",
      overlap: true,
    },
  },
  {
    id: "slide-right",
    name: "Slide Right",
    category: "motion",
    transition: {
      type: "slide",
      duration: 500,
      easing: "ease-out",
      direction: "right",
      overlap: true,
    },
  },
  {
    id: "push-left",
    name: "Push Left",
    category: "motion",
    transition: {
      type: "push",
      duration: 500,
      easing: "ease-in-out",
      direction: "left",
    },
  },
  {
    id: "push-right",
    name: "Push Right",
    category: "motion",
    transition: {
      type: "push",
      duration: 500,
      easing: "ease-in-out",
      direction: "right",
    },
  },
  {
    id: "zoom-in",
    name: "Zoom In",
    category: "motion",
    transition: {
      type: "zoom",
      duration: 600,
      easing: "ease-in",
      scale: 2,
      origin: { x: 0.5, y: 0.5 },
      zoomIn: true,
    },
  },
  {
    id: "zoom-out",
    name: "Zoom Out",
    category: "motion",
    transition: {
      type: "zoom",
      duration: 600,
      easing: "ease-out",
      scale: 0.5,
      origin: { x: 0.5, y: 0.5 },
      zoomIn: false,
    },
  },
  {
    id: "iris-circle",
    name: "Iris Circle",
    category: "creative",
    transition: {
      type: "iris",
      duration: 700,
      easing: "ease-in-out",
      shape: "circle",
      origin: { x: 0.5, y: 0.5 },
      openToClose: false,
    },
  },
  {
    id: "iris-star",
    name: "Iris Star",
    category: "creative",
    transition: {
      type: "iris",
      duration: 700,
      easing: "ease-in-out",
      shape: "star",
      origin: { x: 0.5, y: 0.5 },
      openToClose: false,
    },
  },
  {
    id: "iris-diamond",
    name: "Iris Diamond",
    category: "creative",
    transition: {
      type: "iris",
      duration: 700,
      easing: "ease-in-out",
      shape: "diamond",
      origin: { x: 0.5, y: 0.5 },
      openToClose: false,
    },
  },
  {
    id: "iris-rectangle",
    name: "Iris Rectangle",
    category: "creative",
    transition: {
      type: "iris",
      duration: 700,
      easing: "ease-in-out",
      shape: "rectangle",
      origin: { x: 0.5, y: 0.5 },
      openToClose: false,
    },
  },
  {
    id: "blur-soft",
    name: "Blur Dissolve",
    category: "blur",
    transition: {
      type: "blur",
      duration: 600,
      easing: "ease-in-out",
      blurAmount: 20,
    },
  },
  {
    id: "blur-heavy",
    name: "Heavy Blur",
    category: "blur",
    transition: {
      type: "blur",
      duration: 800,
      easing: "ease-in-out",
      blurAmount: 50,
    },
  },
  {
    id: "crossfade-default",
    name: "Crossfade",
    category: "basic",
    transition: {
      type: "crossfade",
      duration: 500,
      easing: "linear",
      audioFade: true,
    },
  },
];

export function createTransition<T extends ClipTransitionType>(
  type: T,
  overrides?: Partial<Transition>,
): Transition {
  const id = `transition-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const defaults: Record<ClipTransitionType, TransitionWithoutId> = {
    dissolve: { type: "dissolve", duration: 500, easing: "linear" },
    fade: { type: "fade", duration: 500, easing: "ease-in-out" },
    wipe: {
      type: "wipe",
      duration: 600,
      easing: "ease-in-out",
      direction: "right",
      feather: 0,
    },
    slide: {
      type: "slide",
      duration: 500,
      easing: "ease-out",
      direction: "left",
      overlap: true,
    },
    push: {
      type: "push",
      duration: 500,
      easing: "ease-in-out",
      direction: "left",
    },
    zoom: {
      type: "zoom",
      duration: 600,
      easing: "ease-in",
      scale: 2,
      origin: { x: 0.5, y: 0.5 },
      zoomIn: true,
    },
    iris: {
      type: "iris",
      duration: 700,
      easing: "ease-in-out",
      shape: "circle",
      origin: { x: 0.5, y: 0.5 },
      openToClose: false,
    },
    blur: {
      type: "blur",
      duration: 600,
      easing: "ease-in-out",
      blurAmount: 20,
    },
    crossfade: {
      type: "crossfade",
      duration: 500,
      easing: "linear",
      audioFade: true,
    },
  };

  return {
    id,
    ...defaults[type],
    ...overrides,
  } as Transition;
}

export function getTransitionPresetById(
  presetId: string,
): TransitionPreset | undefined {
  return TRANSITION_PRESETS.find((p) => p.id === presetId);
}

export function getTransitionPresetsByCategory(
  category: TransitionPreset["category"],
): TransitionPreset[] {
  return TRANSITION_PRESETS.filter((p) => p.category === category);
}
