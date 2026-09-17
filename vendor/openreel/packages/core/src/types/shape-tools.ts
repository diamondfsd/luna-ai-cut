import type { Vector2D, BezierPath, BezierPoint } from "./composition";

export type ShapeTool =
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "star"
  | "pen"
  | "line";

export type ShapeMergeOperation =
  | "union"
  | "subtract"
  | "intersect"
  | "exclude";

export interface TrimPathConfig {
  start: number;
  end: number;
  offset: number;
  individualStrokes: boolean;
}

export interface StrokeAnimationConfig {
  trimPath?: TrimPathConfig;
  dashOffset?: number;
  strokeWidth?: number;
}

export interface RectangleShapeConfig {
  type: "rectangle";
  position: Vector2D;
  size: Vector2D;
  roundness: number;
}

export interface EllipseShapeConfig {
  type: "ellipse";
  center: Vector2D;
  radius: Vector2D;
}

export interface PolygonShapeConfig {
  type: "polygon";
  center: Vector2D;
  radius: number;
  sides: number;
  rotation: number;
}

export interface StarShapeConfig {
  type: "star";
  center: Vector2D;
  outerRadius: number;
  innerRadius: number;
  points: number;
  rotation: number;
}

export interface LineShapeConfig {
  type: "line";
  start: Vector2D;
  end: Vector2D;
}

export interface PenShapeConfig {
  type: "pen";
  path: BezierPath;
}

export type ShapeConfig =
  | RectangleShapeConfig
  | EllipseShapeConfig
  | PolygonShapeConfig
  | StarShapeConfig
  | LineShapeConfig
  | PenShapeConfig;

export interface ShapeToolState {
  activeTool: ShapeTool | null;
  isDrawing: boolean;
  currentPath: BezierPoint[];
  startPoint: Vector2D | null;
  currentPoint: Vector2D | null;
  shapeConfig: Partial<ShapeConfig>;
}

export function createDefaultShapeToolState(): ShapeToolState {
  return {
    activeTool: null,
    isDrawing: false,
    currentPath: [],
    startPoint: null,
    currentPoint: null,
    shapeConfig: {},
  };
}

export function createDefaultRectangleConfig(
  center: Vector2D,
  size: Vector2D = { x: 200, y: 150 },
): RectangleShapeConfig {
  return {
    type: "rectangle",
    position: { x: center.x - size.x / 2, y: center.y - size.y / 2 },
    size,
    roundness: 0,
  };
}

export function createDefaultEllipseConfig(
  center: Vector2D,
  radius: Vector2D = { x: 100, y: 75 },
): EllipseShapeConfig {
  return {
    type: "ellipse",
    center,
    radius,
  };
}

export function createDefaultPolygonConfig(
  center: Vector2D,
  radius: number = 100,
  sides: number = 6,
): PolygonShapeConfig {
  return {
    type: "polygon",
    center,
    radius,
    sides: Math.max(3, sides),
    rotation: 0,
  };
}

export function createDefaultStarConfig(
  center: Vector2D,
  outerRadius: number = 100,
  innerRadius: number = 50,
  points: number = 5,
): StarShapeConfig {
  return {
    type: "star",
    center,
    outerRadius,
    innerRadius: Math.min(innerRadius, outerRadius * 0.9),
    points: Math.max(3, points),
    rotation: -90,
  };
}

export function createDefaultLineConfig(
  start: Vector2D,
  end: Vector2D,
): LineShapeConfig {
  return {
    type: "line",
    start,
    end,
  };
}

export function createDefaultPenConfig(): PenShapeConfig {
  return {
    type: "pen",
    path: {
      points: [],
      closed: false,
    },
  };
}

export function createDefaultTrimPath(): TrimPathConfig {
  return {
    start: 0,
    end: 100,
    offset: 0,
    individualStrokes: false,
  };
}
