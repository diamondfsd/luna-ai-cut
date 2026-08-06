import type { AnimationPath, AnimationPropertyPath } from "@/animation/types";
import { ANIMATION_PROPERTY_PATHS } from "./types";
import { isEffectParamPath } from "./effect-param-channel";
import { isGraphicParamPath } from "./graphic-param-channel";

const ANIMATION_PROPERTY_PATH_SET = new Set<string>(ANIMATION_PROPERTY_PATHS);

export function isAnimationPropertyPath(
	propertyPath: string,
): propertyPath is AnimationPropertyPath {
	return ANIMATION_PROPERTY_PATH_SET.has(propertyPath);
}

export function isAnimationPath(
	propertyPath: string,
): propertyPath is AnimationPath {
	return (
		isAnimationPropertyPath(propertyPath) ||
		isGraphicParamPath(propertyPath) ||
		isEffectParamPath(propertyPath)
	);
}
