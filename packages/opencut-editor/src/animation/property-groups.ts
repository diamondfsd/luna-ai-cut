import type {
	AnimationPropertyGroup,
	AnimationPropertyPath,
	ElementAnimations,
} from "@/animation/types";
import { ANIMATION_PROPERTY_GROUPS } from "@/animation/types";
import { getKeyframeAtTime } from "./keyframe-query";

export interface GroupKeyframeRef {
	propertyPath: AnimationPropertyPath;
	keyframeId: string;
}

export function getGroupKeyframesAtTime({
	animations,
	group,
	time,
}: {
	animations: ElementAnimations | undefined;
	group: AnimationPropertyGroup;
	time: number;
}): GroupKeyframeRef[] {
	return ANIMATION_PROPERTY_GROUPS[group].flatMap((propertyPath) => {
		const keyframe = getKeyframeAtTime({ animations, propertyPath, time });
		return keyframe ? [{ propertyPath, keyframeId: keyframe.id }] : [];
	});
}

export function hasGroupKeyframeAtTime({
	animations,
	group,
	time,
}: {
	animations: ElementAnimations | undefined;
	group: AnimationPropertyGroup;
	time: number;
}): boolean {
	return getGroupKeyframesAtTime({ animations, group, time }).length > 0;
}
