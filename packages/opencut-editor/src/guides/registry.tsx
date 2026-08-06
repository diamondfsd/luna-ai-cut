import type { GuideDefinition } from "@/guides/types";
import { gridGuide } from "./definitions/grid";
// import { customGuide } from "./definitions/custom";
import {
	tiktokGuide,
	igReelsGuide,
	ytShortsGuide,
	spotlightGuide,
} from "./definitions/platforms";

export type { GuideDefinition, GuideRenderProps } from "@/guides/types";

export const GUIDE_REGISTRY = [
	gridGuide,
	tiktokGuide,
	igReelsGuide,
	ytShortsGuide,
	spotlightGuide,

	// todo: wire up custom guide fully, then uncomment this:
	// customGuide,
] as const satisfies readonly GuideDefinition[];

export type GuideId = (typeof GUIDE_REGISTRY)[number]["id"];

export function isGuideId(value: string): value is GuideId {
	return GUIDE_REGISTRY.some((guide) => guide.id === value);
}
