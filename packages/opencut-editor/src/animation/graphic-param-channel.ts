import type {
	ElementAnimations,
	GraphicParamPath,
} from "@/animation/types";
import type { ParamDefinition, ParamValues } from "@/params";
import { resolveAnimationPathValueAtTime } from "./resolve";

export const GRAPHIC_PARAM_PATH_PREFIX = "params.";

export function buildGraphicParamPath({
	paramKey,
}: {
	paramKey: string;
}): GraphicParamPath {
	return `${GRAPHIC_PARAM_PATH_PREFIX}${paramKey}`;
}

export function isGraphicParamPath(
	propertyPath: string,
): propertyPath is GraphicParamPath {
	return propertyPath.startsWith(GRAPHIC_PARAM_PATH_PREFIX);
}

export function parseGraphicParamPath({
	propertyPath,
}: {
	propertyPath: string;
}): { paramKey: string } | null {
	if (!isGraphicParamPath(propertyPath)) {
		return null;
	}

	const paramKey = propertyPath.slice(GRAPHIC_PARAM_PATH_PREFIX.length);
	return paramKey.length > 0 ? { paramKey } : null;
}

export function resolveGraphicParamsAtTime({
	params,
	definitions,
	animations,
	localTime,
}: {
	params: ParamValues;
	definitions: ParamDefinition[];
	animations?: ElementAnimations;
	localTime: number;
}): ParamValues {
	const resolved: ParamValues = { ...params };

	for (const param of definitions) {
		const path = buildGraphicParamPath({ paramKey: param.key });
		if (!animations?.[path]) {
			continue;
		}

		resolved[param.key] = resolveAnimationPathValueAtTime({
			animations,
			propertyPath: path,
			localTime: Math.max(0, localTime),
			fallbackValue: params[param.key] ?? param.default,
		});
	}

	return resolved;
}
