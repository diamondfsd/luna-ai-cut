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
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface Vector2D {
  x: number;
  y: number;
}

export interface Vector3D extends Vector2D {
  z: number;
}

export interface Transform {
  position: Vector2D;
  scale: Vector2D;
  rotation: number;
  opacity: number;
  anchorPoint: Vector2D;
  position3D?: Vector3D;
  scale3D?: Vector3D;
  rotation3D?: Vector3D;
}

export interface BezierPoint {
  point: Vector2D;
  inTangent?: Vector2D;
  outTangent?: Vector2D;
}

export interface BezierPath {
  points: BezierPoint[];
  closed: boolean;
}

export interface FillStyle {
  type: "solid" | "gradient" | "none";
  color?: string;
  gradient?: {
    type: "linear" | "radial";
    stops: Array<{ offset: number; color: string }>;
    start?: Vector2D;
    end?: Vector2D;
  };
}

export interface StrokeStyle {
  color: string;
  width: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  dashArray?: number[];
  dashOffset?: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  fontStyle: "normal" | "italic" | "oblique";
  color: string;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacing: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecoration?: "none" | "underline" | "line-through" | "overline";
}

export interface TextAnimation {
  preset: string;
  duration: number;
  delay?: number;
  stagger?: number;
  ease?: string;
  properties?: Record<string, any>;
}

export interface TextOnPath {
  path: BezierPath;
  alignment: "left" | "center" | "right";
  offset: number;
  perpendicular: boolean;
}

export type EasingFunction =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "ease-in-cubic"
  | "ease-out-cubic"
  | "ease-in-out-cubic"
  | "ease-in-quad"
  | "ease-out-quad"
  | "ease-in-out-quad"
  | "ease-in-quart"
  | "ease-out-quart"
  | "ease-in-out-quart"
  | "ease-in-quint"
  | "ease-out-quint"
  | "ease-in-out-quint"
  | "ease-in-sine"
  | "ease-out-sine"
  | "ease-in-out-sine"
  | "ease-in-expo"
  | "ease-out-expo"
  | "ease-in-out-expo"
  | "ease-in-circ"
  | "ease-out-circ"
  | "ease-in-out-circ"
  | "ease-in-back"
  | "ease-out-back"
  | "ease-in-out-back"
  | "ease-in-elastic"
  | "ease-out-elastic"
  | "ease-in-out-elastic"
  | "ease-in-bounce"
  | "ease-out-bounce"
  | "ease-in-out-bounce";

export interface Keyframe {
  time: number;
  value: any;
  ease?: EasingFunction;
  velocity?: number;
}

export interface PropertyKeyframes {
  property: string;
  keyframes: Keyframe[];
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color?: string;
}

export interface AudioBinding {
  layerId: string;
  property: string;
  frequencyRange: [number, number];
  sensitivity: number;
  mode: "frequency" | "beat";
}

export type LayerType =
  | "shape"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "group";

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  startTime: number;
  duration: number;
  transform: Transform;
  visible: boolean;
  locked: boolean;
  blendMode?: BlendMode;
  parent?: string;
  keyframes: PropertyKeyframes[];
}

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shapeType: "rectangle" | "circle" | "polygon" | "ellipse" | "path" | "star";
  path?: BezierPath;
  fill: FillStyle;
  stroke?: StrokeStyle;
  morphTarget?: BezierPath;
  roundness?: number;
  points?: number;
  innerRadius?: number;
  outerRadius?: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  content: string;
  style: TextStyle;
  textAnimation?: TextAnimation;
  textPath?: TextOnPath;
  maxWidth?: number;
  autoSize: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  imageUrl: string;
  fit?: "cover" | "contain" | "fill" | "none";
}

export interface VideoLayer extends BaseLayer {
  type: "video";
  videoUrl: string;
  playbackRate?: number;
  volume?: number;
  fit?: "cover" | "contain" | "fill" | "none";
}

export interface AudioLayer extends BaseLayer {
  type: "audio";
  audioUrl: string;
  volume?: number;
  playbackRate?: number;
}

export interface GroupLayer extends BaseLayer {
  type: "group";
  children: string[];
}

export type Layer =
  | ShapeLayer
  | TextLayer
  | ImageLayer
  | VideoLayer
  | AudioLayer
  | GroupLayer;

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  backgroundColor: string;
  layers: Layer[];
  audioBindings?: AudioBinding[];
  markers?: Marker[];
  createdAt?: number;
  updatedAt?: number;
}

export type VariableType = "text" | "color" | "image" | "number" | "boolean";

export interface Variable {
  name: string;
  type: VariableType;
  label: string;
  defaultValue: any;
  targetLayerIds: string[];
  targetProperty?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export type TemplateCategory =
  | "social"
  | "logo"
  | "explainer"
  | "callout"
  | "title"
  | "transition";

export interface Template {
  id: string;
  name: string;
  description?: string;
  category: TemplateCategory;
  tags?: string[];
  thumbnailUrl: string;
  previewUrl?: string;
  composition: Composition;
  variables: Variable[];
  createdAt?: number;
  updatedAt?: number;
  author?: string;
  version?: string;
}

export interface TemplatePreset {
  id: string;
  name: string;
  templates: Template[];
}
