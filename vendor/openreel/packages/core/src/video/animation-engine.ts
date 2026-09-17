import type { Keyframe, EasingType } from "../types/timeline";
import {
  EASING_FUNCTIONS,
  type EasingName,
} from "../animation/easing-functions";

export interface BezierControlPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface InterpolationResult {
  value: unknown;
  keyframeA: Keyframe | null;
  keyframeB: Keyframe | null;
  progress: number;
}

export class AnimationEngine {
  private bezierCache: Map<string, (t: number) => number> = new Map();

  getValueAtTime(keyframes: Keyframe[], time: number): InterpolationResult {
    if (keyframes.length === 0) {
      return {
        value: undefined,
        keyframeA: null,
        keyframeB: null,
        progress: 0,
      };
    }
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (time <= sorted[0].time) {
      return {
        value: sorted[0].value,
        keyframeA: sorted[0],
        keyframeB: null,
        progress: 0,
      };
    }
    if (time >= sorted[sorted.length - 1].time) {
      return {
        value: sorted[sorted.length - 1].value,
        keyframeA: sorted[sorted.length - 1],
        keyframeB: null,
        progress: 1,
      };
    }
    let keyframeA: Keyframe | null = null;
    let keyframeB: Keyframe | null = null;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        keyframeA = sorted[i];
        keyframeB = sorted[i + 1];
        break;
      }
    }

    if (!keyframeA || !keyframeB) {
      return {
        value: sorted[sorted.length - 1].value,
        keyframeA: sorted[sorted.length - 1],
        keyframeB: null,
        progress: 1,
      };
    }
    const duration = keyframeB.time - keyframeA.time;
    const elapsed = time - keyframeA.time;
    const linearProgress = duration > 0 ? elapsed / duration : 0;
    const easedProgress = this.applyEasing(linearProgress, keyframeA.easing);
    const value = this.interpolateValue(
      keyframeA.value,
      keyframeB.value,
      easedProgress,
    );

    return {
      value,
      keyframeA,
      keyframeB,
      progress: easedProgress,
    };
  }

  interpolate(kf1: Keyframe, kf2: Keyframe, time: number): unknown {
    const [keyframeA, keyframeB] =
      kf1.time <= kf2.time ? [kf1, kf2] : [kf2, kf1];
    const clampedTime = Math.max(
      keyframeA.time,
      Math.min(keyframeB.time, time),
    );
    const duration = keyframeB.time - keyframeA.time;
    const elapsed = clampedTime - keyframeA.time;
    const linearProgress = duration > 0 ? elapsed / duration : 0;
    const easedProgress = this.applyEasing(linearProgress, keyframeA.easing);
    return this.interpolateValue(
      keyframeA.value,
      keyframeB.value,
      easedProgress,
    );
  }

  applyEasing(
    t: number,
    easing: EasingType,
    bezierPoints?: BezierControlPoints,
  ): number {
    const clampedT = Math.max(0, Math.min(1, t));

    if (easing === "bezier") {
      if (bezierPoints) {
        return this.cubicBezier(
          clampedT,
          bezierPoints.x1,
          bezierPoints.y1,
          bezierPoints.x2,
          bezierPoints.y2,
        );
      }
      return this.cubicBezier(clampedT, 0.25, 0.1, 0.25, 1.0);
    }

    if (easing === "ease-in") {
      return EASING_FUNCTIONS.easeInQuad(clampedT);
    }

    if (easing === "ease-out") {
      return EASING_FUNCTIONS.easeOutQuad(clampedT);
    }

    if (easing === "ease-in-out") {
      return EASING_FUNCTIONS.easeInOutQuad(clampedT);
    }

    const easingFn = EASING_FUNCTIONS[easing as EasingName];
    if (easingFn) {
      return easingFn(clampedT);
    }

    return clampedT;
  }

  cubicBezier(
    t: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
    const cacheKey = `${x1},${y1},${x2},${y2}`;

    let bezierFn = this.bezierCache.get(cacheKey);
    if (!bezierFn) {
      bezierFn = this.createBezierFunction(x1, y1, x2, y2);
      this.bezierCache.set(cacheKey, bezierFn);
    }

    return bezierFn(t);
  }

  /**
   * Creates cubic bezier easing function using hybrid root-finding.
   * Converts 2D bezier curve (x-based) into 1D easing (progress) by solving
   * sampleCurveX(t) = x, then returning sampleCurveY(t).
   *
   * Optimization: First attempts Newton-Raphson (fast quadratic convergence),
   * then falls back to bisection (slower but guaranteed convergence) for robustness.
   */
  private createBezierFunction(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): (t: number) => number {
    // Thresholds for numerical algorithms
    const NEWTON_ITERATIONS = 4;
    const NEWTON_MIN_SLOPE = 0.001;
    const SUBDIVISION_PRECISION = 0.0000001;
    const SUBDIVISION_MAX_ITERATIONS = 10;

    // Cubic bezier polynomial coefficients for X: B(t) = ax*t^3 + bx*t^2 + cx*t
    const ax = 3 * x1 - 3 * x2 + 1;
    const bx = 3 * x2 - 6 * x1;
    const cx = 3 * x1;

    // Same for Y curve
    const ay = 3 * y1 - 3 * y2 + 1;
    const by = 3 * y2 - 6 * y1;
    const cy = 3 * y1;

    // Horner's form for O(1) polynomial evaluation
    const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
    const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;
    // Derivative: dB/dt = 3*ax*t^2 + 2*bx*t + cx
    const sampleCurveDerivativeX = (t: number) =>
      (3 * ax * t + 2 * bx) * t + cx;

    const solveCurveX = (x: number): number => {
      let t2 = x;

      // Newton-Raphson: fast convergence for well-behaved curves
      // t_new = t - f(t)/f'(t) to find where sampleCurveX(t) = x
      for (let i = 0; i < NEWTON_ITERATIONS; i++) {
        const slope = sampleCurveDerivativeX(t2);
        if (Math.abs(slope) < NEWTON_MIN_SLOPE) break; // Slope too flat, bisection more stable
        const currentX = sampleCurveX(t2) - x;
        t2 -= currentX / slope;
      }

      // Bisection fallback: guaranteed convergence but slower (O(log n))
      let t0 = 0;
      let t1 = 1;
      t2 = x;

      for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i++) {
        const currentX = sampleCurveX(t2) - x;
        if (Math.abs(currentX) < SUBDIVISION_PRECISION) break;
        if (currentX > 0) {
          t1 = t2; // Root is in lower half
        } else {
          t0 = t2; // Root is in upper half
        }
        t2 = (t1 + t0) / 2;
      }

      return t2;
    };

    return (x: number) => {
      if (x === 0) return 0;
      if (x === 1) return 1;
      return sampleCurveY(solveCurveX(x));
    };
  }

  interpolateValue(
    valueA: unknown,
    valueB: unknown,
    progress: number,
  ): unknown {
    if (typeof valueA === "number" && typeof valueB === "number") {
      return valueA + (valueB - valueA) * progress;
    }
    if (
      typeof valueA === "object" &&
      typeof valueB === "object" &&
      valueA !== null &&
      valueB !== null
    ) {
      const result: Record<string, unknown> = {};
      const objA = valueA as Record<string, unknown>;
      const objB = valueB as Record<string, unknown>;

      for (const key of Object.keys(objA)) {
        if (key in objB) {
          result[key] = this.interpolateValue(objA[key], objB[key], progress);
        } else {
          result[key] = objA[key];
        }
      }

      return result;
    }
    return progress < 0.5 ? valueA : valueB;
  }
  // Keyframe CRUD Operations
  addKeyframe(keyframes: Keyframe[], keyframe: Keyframe): Keyframe[] {
    const existingIndex = keyframes.findIndex(
      (kf) => kf.time === keyframe.time && kf.property === keyframe.property,
    );

    if (existingIndex >= 0) {
      const result = [...keyframes];
      result[existingIndex] = keyframe;
      return result;
    }
    return [...keyframes, keyframe].sort((a, b) => a.time - b.time);
  }

  removeKeyframe(keyframes: Keyframe[], keyframeId: string): Keyframe[] {
    return keyframes.filter((kf) => kf.id !== keyframeId);
  }

  updateKeyframe(
    keyframes: Keyframe[],
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id">>,
  ): Keyframe[] {
    const result = keyframes.map((kf) => {
      if (kf.id === keyframeId) {
        return { ...kf, ...updates };
      }
      return kf;
    });
    if (updates.time !== undefined) {
      result.sort((a, b) => a.time - b.time);
    }

    return result;
  }

  getKeyframesForProperty(keyframes: Keyframe[], property: string): Keyframe[] {
    return keyframes
      .filter((kf) => kf.property === property)
      .sort((a, b) => a.time - b.time);
  }

  findKeyframeAtTime(
    keyframes: Keyframe[],
    property: string,
    time: number,
    tolerance: number = 0.001,
  ): Keyframe | null {
    return (
      keyframes.find(
        (kf) =>
          kf.property === property && Math.abs(kf.time - time) <= tolerance,
      ) || null
    );
  }

  clearCache(): void {
    this.bezierCache.clear();
  }
}
export const animationEngine = new AnimationEngine();
