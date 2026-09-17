import type { Vector3D, EasingFunction } from "./composition";

export interface Transform3D {
  position: Vector3D;
  anchor: Vector3D;
  scale: Vector3D;
  rotation: Vector3D;
  opacity: number;
}

export interface Camera {
  id: string;
  name: string;
  position: Vector3D;
  pointOfInterest: Vector3D;
  zoom: number;
  depthOfField?: DepthOfFieldConfig;
  enabled: boolean;
}

export interface DepthOfFieldConfig {
  focusDistance: number;
  aperture: number;
  blurLevel: number;
}

export interface Layer3DConfig {
  is3D: boolean;
  transform: Transform3D;
  autoOrient?: AutoOrientMode;
  castShadow?: boolean;
  acceptShadow?: boolean;
}

export type AutoOrientMode =
  | "none"
  | "along-path"
  | "towards-camera"
  | "towards-point";

export interface Layer3DKeyframe {
  time: number;
  transform: Partial<Transform3D>;
  easing?: EasingFunction;
}

export const DEFAULT_TRANSFORM_3D: Transform3D = {
  position: { x: 0, y: 0, z: 0 },
  anchor: { x: 0, y: 0, z: 0 },
  scale: { x: 100, y: 100, z: 100 },
  rotation: { x: 0, y: 0, z: 0 },
  opacity: 1,
};

export const DEFAULT_CAMERA: Omit<Camera, "id"> = {
  name: "Camera 1",
  position: { x: 0, y: 0, z: -1000 },
  pointOfInterest: { x: 0, y: 0, z: 0 },
  zoom: 1000,
  enabled: true,
};

export function createCamera(overrides?: Partial<Omit<Camera, "id">>): Camera {
  const id = `camera-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    ...DEFAULT_CAMERA,
    ...overrides,
  };
}

export function createLayer3DConfig(is3D: boolean = false): Layer3DConfig {
  return {
    is3D,
    transform: { ...DEFAULT_TRANSFORM_3D },
    autoOrient: "none",
    castShadow: false,
    acceptShadow: false,
  };
}

export interface Transform3DPreset {
  id: string;
  name: string;
  category: "rotation" | "flip" | "swing" | "orbit" | "depth";
  keyframes: Layer3DKeyframe[];
  duration: number;
}

export const TRANSFORM_3D_PRESETS: Transform3DPreset[] = [
  {
    id: "flip-horizontal",
    name: "Flip Horizontal",
    category: "flip",
    duration: 600,
    keyframes: [
      { time: 0, transform: { rotation: { x: 0, y: 0, z: 0 } } },
      {
        time: 300,
        transform: { rotation: { x: 0, y: 90, z: 0 } },
        easing: "ease-in",
      },
      {
        time: 600,
        transform: { rotation: { x: 0, y: 180, z: 0 } },
        easing: "ease-out",
      },
    ],
  },
  {
    id: "flip-vertical",
    name: "Flip Vertical",
    category: "flip",
    duration: 600,
    keyframes: [
      { time: 0, transform: { rotation: { x: 0, y: 0, z: 0 } } },
      {
        time: 300,
        transform: { rotation: { x: 90, y: 0, z: 0 } },
        easing: "ease-in",
      },
      {
        time: 600,
        transform: { rotation: { x: 180, y: 0, z: 0 } },
        easing: "ease-out",
      },
    ],
  },
  {
    id: "rotate-x",
    name: "Rotate X 360",
    category: "rotation",
    duration: 1000,
    keyframes: [
      { time: 0, transform: { rotation: { x: 0, y: 0, z: 0 } } },
      {
        time: 1000,
        transform: { rotation: { x: 360, y: 0, z: 0 } },
        easing: "ease-in-out",
      },
    ],
  },
  {
    id: "rotate-y",
    name: "Rotate Y 360",
    category: "rotation",
    duration: 1000,
    keyframes: [
      { time: 0, transform: { rotation: { x: 0, y: 0, z: 0 } } },
      {
        time: 1000,
        transform: { rotation: { x: 0, y: 360, z: 0 } },
        easing: "ease-in-out",
      },
    ],
  },
  {
    id: "swing",
    name: "Swing",
    category: "swing",
    duration: 800,
    keyframes: [
      { time: 0, transform: { rotation: { x: 0, y: 0, z: 0 } } },
      {
        time: 200,
        transform: { rotation: { x: 0, y: 15, z: 0 } },
        easing: "ease-out",
      },
      {
        time: 400,
        transform: { rotation: { x: 0, y: -10, z: 0 } },
        easing: "ease-in-out",
      },
      {
        time: 600,
        transform: { rotation: { x: 0, y: 5, z: 0 } },
        easing: "ease-in-out",
      },
      {
        time: 800,
        transform: { rotation: { x: 0, y: 0, z: 0 } },
        easing: "ease-in",
      },
    ],
  },
  {
    id: "swing-drop",
    name: "Swing Drop",
    category: "swing",
    duration: 1000,
    keyframes: [
      {
        time: 0,
        transform: {
          rotation: { x: -90, y: 0, z: 0 },
          position: { x: 0, y: -50, z: 0 },
        },
      },
      {
        time: 500,
        transform: {
          rotation: { x: 10, y: 0, z: 0 },
          position: { x: 0, y: 0, z: 0 },
        },
        easing: "ease-out-bounce",
      },
      {
        time: 750,
        transform: { rotation: { x: -5, y: 0, z: 0 } },
        easing: "ease-in-out",
      },
      {
        time: 1000,
        transform: { rotation: { x: 0, y: 0, z: 0 } },
        easing: "ease-in",
      },
    ],
  },
  {
    id: "depth-push",
    name: "Push Back",
    category: "depth",
    duration: 500,
    keyframes: [
      { time: 0, transform: { position: { x: 0, y: 0, z: 0 } } },
      {
        time: 500,
        transform: { position: { x: 0, y: 0, z: -200 } },
        easing: "ease-out",
      },
    ],
  },
  {
    id: "depth-pull",
    name: "Pull Forward",
    category: "depth",
    duration: 500,
    keyframes: [
      { time: 0, transform: { position: { x: 0, y: 0, z: 0 } } },
      {
        time: 500,
        transform: { position: { x: 0, y: 0, z: 200 } },
        easing: "ease-out",
      },
    ],
  },
  {
    id: "orbit-horizontal",
    name: "Orbit Horizontal",
    category: "orbit",
    duration: 2000,
    keyframes: [
      {
        time: 0,
        transform: {
          position: { x: 200, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      },
      {
        time: 500,
        transform: {
          position: { x: 0, y: 0, z: 200 },
          rotation: { x: 0, y: 90, z: 0 },
        },
        easing: "linear",
      },
      {
        time: 1000,
        transform: {
          position: { x: -200, y: 0, z: 0 },
          rotation: { x: 0, y: 180, z: 0 },
        },
        easing: "linear",
      },
      {
        time: 1500,
        transform: {
          position: { x: 0, y: 0, z: -200 },
          rotation: { x: 0, y: 270, z: 0 },
        },
        easing: "linear",
      },
      {
        time: 2000,
        transform: {
          position: { x: 200, y: 0, z: 0 },
          rotation: { x: 0, y: 360, z: 0 },
        },
        easing: "linear",
      },
    ],
  },
  {
    id: "card-flip",
    name: "Card Flip",
    category: "flip",
    duration: 800,
    keyframes: [
      {
        time: 0,
        transform: {
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 100, y: 100, z: 100 },
        },
      },
      {
        time: 400,
        transform: {
          rotation: { x: 0, y: 90, z: 0 },
          scale: { x: 100, y: 100, z: 100 },
        },
        easing: "ease-in",
      },
      {
        time: 800,
        transform: {
          rotation: { x: 0, y: 180, z: 0 },
          scale: { x: 100, y: 100, z: 100 },
        },
        easing: "ease-out",
      },
    ],
  },
];

export function getTransform3DPresetsByCategory(
  category: Transform3DPreset["category"],
): Transform3DPreset[] {
  return TRANSFORM_3D_PRESETS.filter((p) => p.category === category);
}

export function getTransform3DPresetById(
  id: string,
): Transform3DPreset | undefined {
  return TRANSFORM_3D_PRESETS.find((p) => p.id === id);
}

export function interpolateTransform3D(
  from: Transform3D,
  to: Transform3D,
  t: number,
): Transform3D {
  return {
    position: {
      x: from.position.x + (to.position.x - from.position.x) * t,
      y: from.position.y + (to.position.y - from.position.y) * t,
      z: from.position.z + (to.position.z - from.position.z) * t,
    },
    anchor: {
      x: from.anchor.x + (to.anchor.x - from.anchor.x) * t,
      y: from.anchor.y + (to.anchor.y - from.anchor.y) * t,
      z: from.anchor.z + (to.anchor.z - from.anchor.z) * t,
    },
    scale: {
      x: from.scale.x + (to.scale.x - from.scale.x) * t,
      y: from.scale.y + (to.scale.y - from.scale.y) * t,
      z: from.scale.z + (to.scale.z - from.scale.z) * t,
    },
    rotation: {
      x: from.rotation.x + (to.rotation.x - from.rotation.x) * t,
      y: from.rotation.y + (to.rotation.y - from.rotation.y) * t,
      z: from.rotation.z + (to.rotation.z - from.rotation.z) * t,
    },
    opacity: from.opacity + (to.opacity - from.opacity) * t,
  };
}

export function mergeTransform3D(
  base: Transform3D,
  partial: Partial<Transform3D>,
): Transform3D {
  return {
    position: partial.position
      ? { ...base.position, ...partial.position }
      : base.position,
    anchor: partial.anchor
      ? { ...base.anchor, ...partial.anchor }
      : base.anchor,
    scale: partial.scale ? { ...base.scale, ...partial.scale } : base.scale,
    rotation: partial.rotation
      ? { ...base.rotation, ...partial.rotation }
      : base.rotation,
    opacity: partial.opacity !== undefined ? partial.opacity : base.opacity,
  };
}
