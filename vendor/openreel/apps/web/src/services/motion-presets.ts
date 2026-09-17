import { v4 as uuid } from "uuid";

export type PresetCategory = "entrance" | "exit" | "emphasis" | "transition";

export type AnimatableProperty =
  | "position"
  | "position.x"
  | "position.y"
  | "scale"
  | "scale.x"
  | "scale.y"
  | "rotation"
  | "opacity";

export type EasingFunction =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "ease-in-cubic"
  | "ease-out-cubic"
  | "ease-in-out-cubic"
  | "ease-out-back"
  | "ease-in-back";

export interface PresetKeyframe {
  time: number;
  value: number;
  easing?: EasingFunction;
}

export interface PresetPropertyTrack {
  property: AnimatableProperty;
  keyframes: PresetKeyframe[];
  relative?: boolean;
}

export interface MotionPreset {
  id: string;
  name: string;
  category: PresetCategory;
  description?: string;
  duration: number;
  tracks: PresetPropertyTrack[];
  tags?: string[];
}

export interface AppliedMotionPreset {
  id: string;
  presetId: string;
  clipId: string;
  startTime: number;
  duration: number;
  type: "in" | "out" | "emphasis";
}

const DB_NAME = "openreel-motion-presets";
const DB_VERSION = 1;
const STORE_NAME = "userPresets";

function openPresetDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

async function loadUserPresetsFromDB(): Promise<MotionPreset[]> {
  try {
    const db = await openPresetDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function savePresetToDB(preset: MotionPreset): Promise<void> {
  try {
    const db = await openPresetDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(preset);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    console.error("Failed to save preset to IndexedDB");
  }
}

async function deletePresetFromDB(presetId: string): Promise<void> {
  try {
    const db = await openPresetDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(presetId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    console.error("Failed to delete preset from IndexedDB");
  }
}

const builtInPresets: MotionPreset[] = [
  {
    id: "fade-in",
    name: "Fade In",
    category: "entrance",
    description: "Smooth fade in from transparent",
    duration: 0.5,
    tags: ["simple", "opacity"],
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0, easing: "ease-out" },
          { time: 0.5, value: 1 },
        ],
      },
    ],
  },
  {
    id: "slide-in-left",
    name: "Slide In Left",
    category: "entrance",
    description: "Slide in from the left edge",
    duration: 0.6,
    tags: ["slide", "direction"],
    tracks: [
      {
        property: "position.x",
        keyframes: [
          { time: 0, value: -200, easing: "ease-out-cubic" },
          { time: 0.6, value: 0 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.2, value: 1 },
        ],
      },
    ],
  },
  {
    id: "slide-in-right",
    name: "Slide In Right",
    category: "entrance",
    description: "Slide in from the right edge",
    duration: 0.6,
    tags: ["slide", "direction"],
    tracks: [
      {
        property: "position.x",
        keyframes: [
          { time: 0, value: 200, easing: "ease-out-cubic" },
          { time: 0.6, value: 0 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.2, value: 1 },
        ],
      },
    ],
  },
  {
    id: "slide-in-top",
    name: "Slide In Top",
    category: "entrance",
    description: "Slide in from the top edge",
    duration: 0.6,
    tags: ["slide", "direction"],
    tracks: [
      {
        property: "position.y",
        keyframes: [
          { time: 0, value: -200, easing: "ease-out-cubic" },
          { time: 0.6, value: 0 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.2, value: 1 },
        ],
      },
    ],
  },
  {
    id: "slide-in-bottom",
    name: "Slide In Bottom",
    category: "entrance",
    description: "Slide in from the bottom edge",
    duration: 0.6,
    tags: ["slide", "direction"],
    tracks: [
      {
        property: "position.y",
        keyframes: [
          { time: 0, value: 200, easing: "ease-out-cubic" },
          { time: 0.6, value: 0 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.2, value: 1 },
        ],
      },
    ],
  },
  {
    id: "scale-in",
    name: "Scale In",
    category: "entrance",
    description: "Pop in with scale animation",
    duration: 0.4,
    tags: ["scale", "pop"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 0, easing: "ease-out-back" },
          { time: 0.4, value: 1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 0, easing: "ease-out-back" },
          { time: 0.4, value: 1 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.1, value: 1 },
        ],
      },
    ],
  },
  {
    id: "pop",
    name: "Pop",
    category: "entrance",
    description: "Quick pop entrance with overshoot",
    duration: 0.3,
    tags: ["scale", "quick"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 0.5, easing: "ease-out-back" },
          { time: 0.3, value: 1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 0.5, easing: "ease-out-back" },
          { time: 0.3, value: 1 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.05, value: 1 },
        ],
      },
    ],
  },
  {
    id: "bounce-in",
    name: "Bounce In",
    category: "entrance",
    description: "Bouncy scale entrance",
    duration: 0.6,
    tags: ["bounce", "playful"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.4, value: 1.15, easing: "ease-out" },
          { time: 0.5, value: 0.9 },
          { time: 0.6, value: 1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.4, value: 1.15, easing: "ease-out" },
          { time: 0.5, value: 0.9 },
          { time: 0.6, value: 1 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.1, value: 1 },
        ],
      },
    ],
  },
  {
    id: "flip-in",
    name: "Flip In",
    category: "entrance",
    description: "3D flip entrance effect",
    duration: 0.5,
    tags: ["3d", "rotation"],
    tracks: [
      {
        property: "rotation",
        keyframes: [
          { time: 0, value: -90, easing: "ease-out" },
          { time: 0.5, value: 0 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.25, value: 1 },
        ],
      },
    ],
  },
  {
    id: "blur-in",
    name: "Blur In",
    category: "entrance",
    description: "Fade in with blur effect",
    duration: 0.5,
    tags: ["blur", "soft"],
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 0, easing: "ease-out" },
          { time: 0.5, value: 1 },
        ],
      },
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1.1, easing: "ease-out" },
          { time: 0.5, value: 1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1.1, easing: "ease-out" },
          { time: 0.5, value: 1 },
        ],
      },
    ],
  },
  {
    id: "fade-out",
    name: "Fade Out",
    category: "exit",
    description: "Smooth fade out to transparent",
    duration: 0.5,
    tags: ["simple", "opacity"],
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.5, value: 0 },
        ],
      },
    ],
  },
  {
    id: "slide-out-left",
    name: "Slide Out Left",
    category: "exit",
    description: "Slide out to the left edge",
    duration: 0.6,
    tags: ["slide", "direction"],
    tracks: [
      {
        property: "position.x",
        keyframes: [
          { time: 0, value: 0, easing: "ease-in-cubic" },
          { time: 0.6, value: -200 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0.4, value: 1 },
          { time: 0.6, value: 0 },
        ],
      },
    ],
  },
  {
    id: "slide-out-right",
    name: "Slide Out Right",
    category: "exit",
    description: "Slide out to the right edge",
    duration: 0.6,
    tags: ["slide", "direction"],
    tracks: [
      {
        property: "position.x",
        keyframes: [
          { time: 0, value: 0, easing: "ease-in-cubic" },
          { time: 0.6, value: 200 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0.4, value: 1 },
          { time: 0.6, value: 0 },
        ],
      },
    ],
  },
  {
    id: "scale-out",
    name: "Scale Out",
    category: "exit",
    description: "Shrink and fade out",
    duration: 0.4,
    tags: ["scale"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in-back" },
          { time: 0.4, value: 0 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in-back" },
          { time: 0.4, value: 0 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0.3, value: 1 },
          { time: 0.4, value: 0 },
        ],
      },
    ],
  },
  {
    id: "shrink",
    name: "Shrink",
    category: "exit",
    description: "Quick shrink exit",
    duration: 0.3,
    tags: ["scale", "quick"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.3, value: 0.5 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.3, value: 0.5 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 1 },
          { time: 0.3, value: 0 },
        ],
      },
    ],
  },
  {
    id: "blur-out",
    name: "Blur Out",
    category: "exit",
    description: "Fade out with blur effect",
    duration: 0.5,
    tags: ["blur", "soft"],
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.5, value: 0 },
        ],
      },
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.5, value: 1.1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.5, value: 1.1 },
        ],
      },
    ],
  },
  {
    id: "pulse",
    name: "Pulse",
    category: "emphasis",
    description: "Subtle pulsing scale effect",
    duration: 0.8,
    tags: ["attention", "loop"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in-out" },
          { time: 0.4, value: 1.1 },
          { time: 0.8, value: 1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in-out" },
          { time: 0.4, value: 1.1 },
          { time: 0.8, value: 1 },
        ],
      },
    ],
  },
  {
    id: "shake",
    name: "Shake",
    category: "emphasis",
    description: "Quick horizontal shake",
    duration: 0.5,
    tags: ["attention", "error"],
    tracks: [
      {
        property: "position.x",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.1, value: -10 },
          { time: 0.2, value: 10 },
          { time: 0.3, value: -10 },
          { time: 0.4, value: 10 },
          { time: 0.5, value: 0 },
        ],
        relative: true,
      },
    ],
  },
  {
    id: "bounce",
    name: "Bounce",
    category: "emphasis",
    description: "Bouncing attention effect",
    duration: 0.6,
    tags: ["attention", "playful"],
    tracks: [
      {
        property: "position.y",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.2, value: -20, easing: "ease-out" },
          { time: 0.4, value: 0, easing: "ease-in" },
          { time: 0.5, value: -10, easing: "ease-out" },
          { time: 0.6, value: 0, easing: "ease-in" },
        ],
        relative: true,
      },
    ],
  },
  {
    id: "wiggle",
    name: "Wiggle",
    category: "emphasis",
    description: "Playful wiggle rotation",
    duration: 0.6,
    tags: ["attention", "playful"],
    tracks: [
      {
        property: "rotation",
        keyframes: [
          { time: 0, value: 0 },
          { time: 0.1, value: -5 },
          { time: 0.2, value: 5 },
          { time: 0.3, value: -5 },
          { time: 0.4, value: 5 },
          { time: 0.5, value: -2 },
          { time: 0.6, value: 0 },
        ],
        relative: true,
      },
    ],
  },
  {
    id: "rubber-band",
    name: "Rubber Band",
    category: "emphasis",
    description: "Elastic stretch effect",
    duration: 0.6,
    tags: ["attention", "playful"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1 },
          { time: 0.2, value: 1.25 },
          { time: 0.35, value: 0.85 },
          { time: 0.5, value: 1.1 },
          { time: 0.6, value: 1 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1 },
          { time: 0.2, value: 0.85 },
          { time: 0.35, value: 1.15 },
          { time: 0.5, value: 0.95 },
          { time: 0.6, value: 1 },
        ],
      },
    ],
  },
  {
    id: "glow-pulse",
    name: "Glow Pulse",
    category: "emphasis",
    description: "Subtle opacity pulse",
    duration: 1,
    tags: ["attention", "subtle"],
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in-out" },
          { time: 0.5, value: 0.7 },
          { time: 1, value: 1 },
        ],
      },
    ],
  },
  {
    id: "cross-dissolve",
    name: "Cross Dissolve",
    category: "transition",
    description: "Simple opacity crossfade",
    duration: 0.5,
    tags: ["simple"],
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { time: 0, value: 1, easing: "linear" },
          { time: 0.5, value: 0 },
        ],
      },
    ],
  },
  {
    id: "wipe-left",
    name: "Wipe Left",
    category: "transition",
    description: "Wipe transition to the left",
    duration: 0.5,
    tags: ["wipe", "direction"],
    tracks: [
      {
        property: "position.x",
        keyframes: [
          { time: 0, value: 0, easing: "ease-in-out" },
          { time: 0.5, value: -100 },
        ],
        relative: true,
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0.3, value: 1 },
          { time: 0.5, value: 0 },
        ],
      },
    ],
  },
  {
    id: "zoom-transition",
    name: "Zoom Transition",
    category: "transition",
    description: "Zoom out transition",
    duration: 0.5,
    tags: ["zoom", "scale"],
    tracks: [
      {
        property: "scale.x",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.5, value: 1.5 },
        ],
      },
      {
        property: "scale.y",
        keyframes: [
          { time: 0, value: 1, easing: "ease-in" },
          { time: 0.5, value: 1.5 },
        ],
      },
      {
        property: "opacity",
        keyframes: [
          { time: 0.2, value: 1 },
          { time: 0.5, value: 0 },
        ],
      },
    ],
  },
];

let userPresets: MotionPreset[] = [];
let presetsInitialized = false;

export async function initializeUserPresets(): Promise<void> {
  if (presetsInitialized) return;
  try {
    userPresets = await loadUserPresetsFromDB();
    presetsInitialized = true;
  } catch {
    userPresets = [];
    presetsInitialized = true;
  }
}

initializeUserPresets();

export function loadMotionPreset(presetId: string): MotionPreset | null {
  const allPresets = [...builtInPresets, ...userPresets];
  return allPresets.find((p) => p.id === presetId) ?? null;
}

export function listAvailablePresets(): MotionPreset[] {
  return [...builtInPresets, ...userPresets];
}

export function listPresetsByCategory(
  category: PresetCategory,
): MotionPreset[] {
  return listAvailablePresets().filter((p) => p.category === category);
}

export function createUserPreset(
  name: string,
  category: PresetCategory,
  tracks: PresetPropertyTrack[],
  description?: string,
): MotionPreset {
  const preset: MotionPreset = {
    id: uuid(),
    name,
    category,
    description,
    duration: calculatePresetDuration(tracks),
    tracks,
    tags: ["custom"],
  };

  userPresets.push(preset);
  savePresetToDB(preset);
  return preset;
}

export function deleteUserPreset(presetId: string): boolean {
  const index = userPresets.findIndex((p) => p.id === presetId);
  if (index === -1) return false;
  userPresets.splice(index, 1);
  deletePresetFromDB(presetId);
  return true;
}

function calculatePresetDuration(tracks: PresetPropertyTrack[]): number {
  let maxDuration = 0;
  for (const track of tracks) {
    for (const kf of track.keyframes) {
      if (kf.time > maxDuration) maxDuration = kf.time;
    }
  }
  return maxDuration;
}

export function searchPresets(query: string): MotionPreset[] {
  const lowerQuery = query.toLowerCase();
  return listAvailablePresets().filter((preset) => {
    if (preset.name.toLowerCase().includes(lowerQuery)) return true;
    if (preset.description?.toLowerCase().includes(lowerQuery)) return true;
    if (preset.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery)))
      return true;
    return false;
  });
}

export function getPresetLibrary(): {
  entrance: MotionPreset[];
  exit: MotionPreset[];
  emphasis: MotionPreset[];
  transition: MotionPreset[];
} {
  const allPresets = listAvailablePresets();
  return {
    entrance: allPresets.filter((p) => p.category === "entrance"),
    exit: allPresets.filter((p) => p.category === "exit"),
    emphasis: allPresets.filter((p) => p.category === "emphasis"),
    transition: allPresets.filter((p) => p.category === "transition"),
  };
}
