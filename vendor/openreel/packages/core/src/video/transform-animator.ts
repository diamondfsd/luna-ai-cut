import type { Transform, Keyframe } from "../types/timeline";
import { AnimationEngine } from "./animation-engine";

export type AnimatableTransformProperty =
  | "position.x"
  | "position.y"
  | "scale.x"
  | "scale.y"
  | "rotation"
  | "opacity"
  | "anchor.x"
  | "anchor.y"
  | "rotate3d.x"
  | "rotate3d.y"
  | "rotate3d.z"
  | "perspective";

export interface AnimatedTransform {
  transform: Transform;
  isAnimated: boolean;
  animatedProperties: AnimatableTransformProperty[];
}

export interface Point2D {
  x: number;
  y: number;
}

export interface TransformMatrix {
  a: number; // scale x
  b: number; // skew y
  c: number; // skew x
  d: number; // scale y
  e: number; // translate x
  f: number; // translate y
}

export const DEFAULT_TRANSFORM: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  rotate3d: { x: 0, y: 0, z: 0 },
  perspective: 1000,
  transformStyle: "flat",
};

export class TransformAnimator {
  private animationEngine: AnimationEngine;

  constructor(animationEngine?: AnimationEngine) {
    this.animationEngine = animationEngine || new AnimationEngine();
  }

  getTransformAtTime(
    baseTransform: Transform,
    keyframes: Keyframe[],
    time: number,
  ): AnimatedTransform {
    const animatedProperties: AnimatableTransformProperty[] = [];
    let isAnimated = false;
    const result = {
      position: { x: baseTransform.position.x, y: baseTransform.position.y },
      scale: { x: baseTransform.scale.x, y: baseTransform.scale.y },
      rotation: baseTransform.rotation,
      anchor: { x: baseTransform.anchor.x, y: baseTransform.anchor.y },
      opacity: baseTransform.opacity,
      rotate3d: baseTransform.rotate3d
        ? { ...baseTransform.rotate3d }
        : { x: 0, y: 0, z: 0 },
      perspective: baseTransform.perspective ?? 1000,
      transformStyle: baseTransform.transformStyle ?? "flat",
    };

    // Animate position.x
    const posXKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "position.x",
    );
    if (posXKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        posXKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.position.x = interpolated.value;
        animatedProperties.push("position.x");
        isAnimated = true;
      }
    }

    // Animate position.y
    const posYKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "position.y",
    );
    if (posYKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        posYKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.position.y = interpolated.value;
        animatedProperties.push("position.y");
        isAnimated = true;
      }
    }

    // Animate scale.x
    const scaleXKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "scale.x",
    );
    if (scaleXKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        scaleXKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.scale.x = interpolated.value;
        animatedProperties.push("scale.x");
        isAnimated = true;
      }
    }

    // Animate scale.y
    const scaleYKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "scale.y",
    );
    if (scaleYKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        scaleYKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.scale.y = interpolated.value;
        animatedProperties.push("scale.y");
        isAnimated = true;
      }
    }

    // Animate rotation
    const rotationKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "rotation",
    );
    if (rotationKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        rotationKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.rotation = interpolated.value;
        animatedProperties.push("rotation");
        isAnimated = true;
      }
    }

    // Animate opacity
    const opacityKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "opacity",
    );
    if (opacityKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        opacityKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.opacity = Math.max(0, Math.min(1, interpolated.value));
        animatedProperties.push("opacity");
        isAnimated = true;
      }
    }

    // Animate anchor.x
    const anchorXKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "anchor.x",
    );
    if (anchorXKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        anchorXKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.anchor.x = interpolated.value;
        animatedProperties.push("anchor.x");
        isAnimated = true;
      }
    }

    // Animate anchor.y
    const anchorYKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "anchor.y",
    );
    if (anchorYKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        anchorYKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.anchor.y = interpolated.value;
        animatedProperties.push("anchor.y");
        isAnimated = true;
      }
    }

    // Animate rotate3d.x
    const rotate3dXKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "rotate3d.x",
    );
    if (rotate3dXKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        rotate3dXKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.rotate3d.x = interpolated.value;
        animatedProperties.push("rotate3d.x");
        isAnimated = true;
      }
    }

    // Animate rotate3d.y
    const rotate3dYKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "rotate3d.y",
    );
    if (rotate3dYKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        rotate3dYKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.rotate3d.y = interpolated.value;
        animatedProperties.push("rotate3d.y");
        isAnimated = true;
      }
    }

    // Animate rotate3d.z
    const rotate3dZKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "rotate3d.z",
    );
    if (rotate3dZKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        rotate3dZKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.rotate3d.z = interpolated.value;
        animatedProperties.push("rotate3d.z");
        isAnimated = true;
      }
    }

    // Animate perspective
    const perspectiveKeyframes = this.animationEngine.getKeyframesForProperty(
      keyframes,
      "perspective",
    );
    if (perspectiveKeyframes.length > 0) {
      const interpolated = this.animationEngine.getValueAtTime(
        perspectiveKeyframes,
        time,
      );
      if (typeof interpolated.value === "number") {
        result.perspective = Math.max(0, interpolated.value);
        animatedProperties.push("perspective");
        isAnimated = true;
      }
    }

    return {
      transform: result,
      isAnimated,
      animatedProperties,
    };
  }

  computeTransformMatrix(
    transform: Transform,
    width: number,
    height: number,
  ): TransformMatrix {
    const anchorX = transform.anchor.x * width;
    const anchorY = transform.anchor.y * height;
    const radians = (transform.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // 1. Translate to anchor point
    // 2. Apply rotation
    // 3. Apply scale
    // 4. Translate back from anchor point
    // 5. Apply position offset

    const scaleX = transform.scale.x;
    const scaleY = transform.scale.y;

    // Combined matrix calculation
    const a = cos * scaleX;
    const b = sin * scaleX;
    const c = -sin * scaleY;
    const d = cos * scaleY;

    // Translation components
    const e =
      transform.position.x +
      anchorX -
      anchorX * cos * scaleX +
      anchorY * sin * scaleY;
    const f =
      transform.position.y +
      anchorY -
      anchorX * sin * scaleX -
      anchorY * cos * scaleY;

    return { a, b, c, d, e, f };
  }

  applyMatrixToPoint(matrix: TransformMatrix, point: Point2D): Point2D {
    return {
      x: matrix.a * point.x + matrix.c * point.y + matrix.e,
      y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
  }

  getRotationCenter(
    transform: Transform,
    width: number,
    height: number,
  ): Point2D {
    return {
      x: transform.position.x + transform.anchor.x * width,
      y: transform.position.y + transform.anchor.y * height,
    };
  }

  rotatePointAroundAnchor(
    point: Point2D,
    anchor: Point2D,
    angleDegrees: number,
  ): Point2D {
    const radians = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    // Translate point to origin (relative to anchor)
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;

    // Rotate
    const rotatedX = dx * cos - dy * sin;
    const rotatedY = dx * sin + dy * cos;

    // Translate back
    return {
      x: rotatedX + anchor.x,
      y: rotatedY + anchor.y,
    };
  }

  createPositionKeyframes(
    startPos: Point2D,
    endPos: Point2D,
    startTime: number,
    endTime: number,
    easing: Keyframe["easing"] = "linear",
  ): Keyframe[] {
    return [
      {
        id: `pos-x-start-${startTime}`,
        time: startTime,
        property: "position.x",
        value: startPos.x,
        easing,
      },
      {
        id: `pos-x-end-${endTime}`,
        time: endTime,
        property: "position.x",
        value: endPos.x,
        easing,
      },
      {
        id: `pos-y-start-${startTime}`,
        time: startTime,
        property: "position.y",
        value: startPos.y,
        easing,
      },
      {
        id: `pos-y-end-${endTime}`,
        time: endTime,
        property: "position.y",
        value: endPos.y,
        easing,
      },
    ];
  }

  createScaleKeyframes(
    startScale: Point2D,
    endScale: Point2D,
    startTime: number,
    endTime: number,
    easing: Keyframe["easing"] = "linear",
  ): Keyframe[] {
    return [
      {
        id: `scale-x-start-${startTime}`,
        time: startTime,
        property: "scale.x",
        value: startScale.x,
        easing,
      },
      {
        id: `scale-x-end-${endTime}`,
        time: endTime,
        property: "scale.x",
        value: endScale.x,
        easing,
      },
      {
        id: `scale-y-start-${startTime}`,
        time: startTime,
        property: "scale.y",
        value: startScale.y,
        easing,
      },
      {
        id: `scale-y-end-${endTime}`,
        time: endTime,
        property: "scale.y",
        value: endScale.y,
        easing,
      },
    ];
  }

  createRotationKeyframes(
    startRotation: number,
    endRotation: number,
    startTime: number,
    endTime: number,
    easing: Keyframe["easing"] = "linear",
  ): Keyframe[] {
    return [
      {
        id: `rotation-start-${startTime}`,
        time: startTime,
        property: "rotation",
        value: startRotation,
        easing,
      },
      {
        id: `rotation-end-${endTime}`,
        time: endTime,
        property: "rotation",
        value: endRotation,
        easing,
      },
    ];
  }

  createOpacityKeyframes(
    startOpacity: number,
    endOpacity: number,
    startTime: number,
    endTime: number,
    easing: Keyframe["easing"] = "linear",
  ): Keyframe[] {
    return [
      {
        id: `opacity-start-${startTime}`,
        time: startTime,
        property: "opacity",
        value: Math.max(0, Math.min(1, startOpacity)),
        easing,
      },
      {
        id: `opacity-end-${endTime}`,
        time: endTime,
        property: "opacity",
        value: Math.max(0, Math.min(1, endOpacity)),
        easing,
      },
    ];
  }

  mergeWithDefaults(partial: Partial<Transform>): Transform {
    return {
      position: partial.position || { ...DEFAULT_TRANSFORM.position },
      scale: partial.scale || { ...DEFAULT_TRANSFORM.scale },
      rotation: partial.rotation ?? DEFAULT_TRANSFORM.rotation,
      anchor: partial.anchor || { ...DEFAULT_TRANSFORM.anchor },
      opacity: partial.opacity ?? DEFAULT_TRANSFORM.opacity,
      rotate3d: partial.rotate3d || { ...DEFAULT_TRANSFORM.rotate3d! },
      perspective: partial.perspective ?? DEFAULT_TRANSFORM.perspective!,
      transformStyle:
        partial.transformStyle ?? DEFAULT_TRANSFORM.transformStyle,
    };
  }
}
export const transformAnimator = new TransformAnimator();
