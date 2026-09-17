export * from "./project";
export * from "./timeline";
export * from "./actions";
export * from "./effects";
export * from "./template";
export * from "./scriptable-template";
export * from "./sound-library";
export * from "./result";

export type {
  Vector2D,
  Vector3D,
  TextOnPath,
  PropertyKeyframes,
  AudioBinding,
  Composition,
  VariableType,
  Variable,
  TemplateCategory as CompositionTemplateCategory,
  Template as CompositionTemplate,
  TemplatePreset as CompositionTemplatePreset,
} from "./composition";

export * from "./transform-3d";

export type {
  LottieAnimation,
  LottieMeta,
  LottieMarker,
  LottieImageAsset,
  LottiePrecompAsset,
  LottiePrecompLayer,
  LottieSolidLayer,
  LottieImageLayer,
  LottieNullLayer,
  LottieShapeLayer,
  LottieTextLayer,
  LottieTransform,
  LottieAnimatedProperty,
  LottieSeparatedProperty,
  LottieKeyframe,
  LottieBezier,
  LottieGroupShape,
  LottieRectShape,
  LottieEllipseShape,
  LottiePathShape,
  LottieFillShape,
  LottieStrokeShape,
  LottieTransformShape,
  LottieTrimShape,
  LottieStrokeDash,
  LottieTextData,
  LottieTextDocument,
  LottieTextDocumentKeyframe,
  LottieTextMoreOptions,
  LottieTextAlignmentOptions,
  LottieTextAnimator,
  LottieTextAnimatorProperties,
  LottieTextSelector,
  LottieFeature,
  LottieCompatibilityResult,
  LottieCompatibilityWarning,
  LottieCompatibilityError,
  LottieExportOptions,
} from "./lottie";
export type {
  BaseLottieLayer,
  LottieAsset as LottieAssetType,
  LottieLayer as LottieLayerType,
  LottieMask as LottieMaskType,
  LottieShape as LottieShapeType,
  BaseLottieShape,
} from "./lottie";
export { DEFAULT_LOTTIE_EXPORT_OPTIONS } from "./lottie";

export type {
  ClipTransitionType,
  WipeDirection,
  SlideDirection,
  IrisShape,
  BaseTransition,
  DissolveTransition,
  FadeTransition,
  WipeTransition,
  SlideTransition,
  PushTransition,
  ZoomTransition,
  IrisTransition,
  BlurTransition,
  CrossfadeTransition,
  LayerTransition,
  ClipTransition,
  TransitionPreset,
} from "./transitions";
export type { Transition as ClipTransitionUnion } from "./transitions";
export {
  TRANSITION_PRESETS,
  createTransition,
  getTransitionPresetById,
  getTransitionPresetsByCategory,
} from "./transitions";

export type {
  ShapeTool,
  ShapeMergeOperation,
  TrimPathConfig,
  StrokeAnimationConfig,
  RectangleShapeConfig,
  EllipseShapeConfig,
  PolygonShapeConfig,
  StarShapeConfig,
  LineShapeConfig,
  PenShapeConfig,
  ShapeConfig,
  ShapeToolState,
} from "./shape-tools";
export {
  createDefaultShapeToolState,
  createDefaultRectangleConfig,
  createDefaultEllipseConfig,
  createDefaultPolygonConfig,
  createDefaultStarConfig,
  createDefaultLineConfig,
  createDefaultPenConfig,
  createDefaultTrimPath,
} from "./shape-tools";
