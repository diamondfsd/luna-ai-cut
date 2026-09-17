import type { EasingType } from "../types/timeline";

export interface AnimationSchema {
  version: string;
  project: ProjectConfig;
  assets?: AssetDefinitions;
  layers: LayerDefinition[];
  audio?: AudioConfig;
  variables?: Record<string, unknown>;
}

export interface ProjectConfig {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  backgroundColor?: string;
}

export interface AssetDefinitions {
  fonts?: FontAsset[];
  images?: ImageAsset[];
  videos?: VideoAsset[];
  audio?: AudioAsset[];
  lottie?: LottieAsset[];
}

export interface FontAsset {
  id: string;
  family: string;
  url?: string;
  weight?: number | string;
  style?: "normal" | "italic";
}

export interface ImageAsset {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

export interface VideoAsset {
  id: string;
  url: string;
  duration?: number;
}

export interface AudioAsset {
  id: string;
  url: string;
  duration?: number;
}

export interface LottieAsset {
  id: string;
  url?: string;
  data?: object;
}

export type LayerType =
  | "text"
  | "image"
  | "video"
  | "shape"
  | "lottie"
  | "particle"
  | "group";

export interface BaseLayer {
  id: string;
  type: LayerType;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  startTime?: number;
  duration?: number;
  position?: Position;
  anchor?: Position;
  scale?: Scale;
  rotation?: number;
  opacity?: number;
  blendMode?: BlendMode;
  mask?: MaskConfig;
  animations?: AnimationDefinition[];
}

export interface Position {
  x: number;
  y: number;
}

export interface Scale {
  x: number;
  y: number;
}

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export interface MaskConfig {
  layerId: string;
  type: "alpha" | "luma" | "inverted";
}

export interface TextLayer extends BaseLayer {
  type: "text";
  content: string;
  style: TextStyle;
  textAnimation?: TextAnimationConfig;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  fill?: string | GradientFill;
  stroke?: StrokeStyle;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  shadow?: ShadowStyle;
}

export interface GradientFill {
  type: "linear" | "radial";
  colors: GradientStop[];
  angle?: number;
}

export interface GradientStop {
  offset: number;
  color: string;
}

export interface StrokeStyle {
  color: string;
  width: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
}

export interface ShadowStyle {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface TextAnimationConfig {
  type: "none" | "perCharacter" | "perWord" | "perLine";
  stagger: number;
  direction?: "forward" | "backward" | "center" | "random";
  preset?: TextAnimationPreset;
}

export type TextAnimationPreset =
  | "typewriter"
  | "fadeIn"
  | "slideUp"
  | "slideDown"
  | "slideLeft"
  | "slideRight"
  | "scaleIn"
  | "scaleOut"
  | "rotateIn"
  | "wave"
  | "bounce"
  | "elastic"
  | "glitch"
  | "neon"
  | "blur";

export interface ImageLayer extends BaseLayer {
  type: "image";
  assetId: string;
  fit?: "contain" | "cover" | "fill" | "none";
  filters?: ImageFilter[];
}

export interface ImageFilter {
  type:
    | "blur"
    | "brightness"
    | "contrast"
    | "grayscale"
    | "sepia"
    | "saturate"
    | "hue-rotate";
  value: number;
}

export interface VideoLayer extends BaseLayer {
  type: "video";
  assetId: string;
  inPoint?: number;
  outPoint?: number;
  playbackRate?: number;
  loop?: boolean;
  muted?: boolean;
}

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shape: ShapeDefinition;
  fill?: string | GradientFill;
  stroke?: StrokeStyle;
}

export type ShapeDefinition =
  | RectangleShape
  | EllipseShape
  | PolygonShape
  | StarShape
  | PathShape;

export interface RectangleShape {
  type: "rectangle";
  width: number;
  height: number;
  cornerRadius?: number | [number, number, number, number];
}

export interface EllipseShape {
  type: "ellipse";
  width: number;
  height: number;
}

export interface PolygonShape {
  type: "polygon";
  sides: number;
  radius: number;
}

export interface StarShape {
  type: "star";
  points: number;
  innerRadius: number;
  outerRadius: number;
}

export interface PathShape {
  type: "path";
  d: string;
  closed?: boolean;
}

export interface LottieLayer extends BaseLayer {
  type: "lottie";
  assetId: string;
  loop?: boolean;
  playbackRate?: number;
}

export interface ParticleLayer extends BaseLayer {
  type: "particle";
  emitter: ParticleEmitterConfig;
}

export interface ParticleEmitterConfig {
  type: "point" | "line" | "circle" | "rectangle";
  emitRate: number;
  lifetime: Range;
  velocity: VelocityConfig;
  gravity?: Position;
  scale?: RangeOverLife;
  opacity?: RangeOverLife;
  rotation?: RotationConfig;
  color?: string | string[];
  particleShape?: "circle" | "square" | "triangle" | "star" | "image";
  particleImageId?: string;
}

export interface Range {
  min: number;
  max: number;
}

export interface RangeOverLife {
  start: Range;
  end: Range;
}

export interface VelocityConfig {
  x: Range;
  y: Range;
  angle?: Range;
  speed?: Range;
}

export interface RotationConfig {
  initial: Range;
  speed: Range;
}

export interface GroupLayer extends BaseLayer {
  type: "group";
  children: LayerDefinition[];
}

export type LayerDefinition =
  | TextLayer
  | ImageLayer
  | VideoLayer
  | ShapeLayer
  | LottieLayer
  | ParticleLayer
  | GroupLayer;

export interface AnimationDefinition {
  property: AnimatableProperty;
  keyframes: KeyframeDefinition[];
  delay?: number;
  repeat?: number | "infinite";
  yoyo?: boolean;
}

export type AnimatableProperty =
  | "position"
  | "position.x"
  | "position.y"
  | "scale"
  | "scale.x"
  | "scale.y"
  | "rotation"
  | "opacity"
  | "anchor"
  | "anchor.x"
  | "anchor.y"
  | "fill"
  | "stroke.color"
  | "stroke.width"
  | "fontSize"
  | "letterSpacing"
  | "blur"
  | "brightness"
  | "contrast"
  | "saturation"
  | string;

export interface KeyframeDefinition {
  time: number;
  value: unknown;
  easing?: EasingType;
}

export interface AudioConfig {
  tracks: AudioTrackConfig[];
}

export interface AudioTrackConfig {
  assetId: string;
  startTime: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
}

export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "color" | "image" | "boolean";
  default: unknown;
  label?: string;
  description?: string;
  options?: unknown[];
  min?: number;
  max?: number;
}

export interface AnimationTemplate extends AnimationSchema {
  templateId: string;
  templateName: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  editableVariables: TemplateVariable[];
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  name: "Untitled Animation",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
  backgroundColor: "#000000",
};

export function createEmptyAnimationSchema(): AnimationSchema {
  return {
    version: "1.0",
    project: { ...DEFAULT_PROJECT_CONFIG },
    assets: {
      fonts: [],
      images: [],
      videos: [],
      audio: [],
      lottie: [],
    },
    layers: [],
    audio: {
      tracks: [],
    },
    variables: {},
  };
}

export function validateAnimationSchema(schema: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!schema || typeof schema !== "object") {
    return { valid: false, errors: ["Schema must be an object"] };
  }

  const s = schema as Record<string, unknown>;

  if (!s.version) {
    errors.push("Missing required field: version");
  }

  if (!s.project || typeof s.project !== "object") {
    errors.push("Missing required field: project");
  } else {
    const project = s.project as Record<string, unknown>;
    if (typeof project.width !== "number" || project.width <= 0) {
      errors.push("project.width must be a positive number");
    }
    if (typeof project.height !== "number" || project.height <= 0) {
      errors.push("project.height must be a positive number");
    }
    if (typeof project.fps !== "number" || project.fps <= 0) {
      errors.push("project.fps must be a positive number");
    }
    if (typeof project.duration !== "number" || project.duration <= 0) {
      errors.push("project.duration must be a positive number");
    }
  }

  if (!Array.isArray(s.layers)) {
    errors.push("layers must be an array");
  }

  return { valid: errors.length === 0, errors };
}

export function substituteVariables(
  schema: AnimationSchema,
  variables: Record<string, unknown>,
): AnimationSchema {
  const merged = { ...schema.variables, ...variables };
  const jsonStr = JSON.stringify(schema);

  const substituted = jsonStr.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = merged[varName];
    if (value === undefined) {
      return match;
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  });

  return JSON.parse(substituted) as AnimationSchema;
}
