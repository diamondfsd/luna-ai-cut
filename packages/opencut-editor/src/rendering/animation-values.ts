import type { ElementAnimations } from "@/animation/types";
import { resolveAnimationPathValueAtTime } from "@/animation";
import type { Transform } from "./index";

export function resolveTransformAtTime({
	baseTransform,
	animations,
	localTime,
}: {
	baseTransform: Transform;
	animations: ElementAnimations | undefined;
	localTime: number;
}): Transform {
	const safeLocalTime = Math.max(0, localTime);
	return {
		position: {
			x: resolveAnimationPathValueAtTime({
				animations,
				propertyPath: "transform.positionX",
				localTime: safeLocalTime,
				fallbackValue: baseTransform.position.x,
			}),
			y: resolveAnimationPathValueAtTime({
				animations,
				propertyPath: "transform.positionY",
				localTime: safeLocalTime,
				fallbackValue: baseTransform.position.y,
			}),
		},
		scaleX: resolveAnimationPathValueAtTime({
			animations,
			propertyPath: "transform.scaleX",
			localTime: safeLocalTime,
			fallbackValue: baseTransform.scaleX,
		}),
		scaleY: resolveAnimationPathValueAtTime({
			animations,
			propertyPath: "transform.scaleY",
			localTime: safeLocalTime,
			fallbackValue: baseTransform.scaleY,
		}),
		rotate: resolveAnimationPathValueAtTime({
			animations,
			propertyPath: "transform.rotate",
			localTime: safeLocalTime,
			fallbackValue: baseTransform.rotate,
		}),
	};
}
