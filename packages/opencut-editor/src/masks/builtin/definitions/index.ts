import {
	masksRegistry,
	type MaskDefinitionForRegistration,
	type MaskIconProps,
} from "../../registry";
import { cinematicBarsMaskDefinition } from "./cinematic-bars";
import { diamondMaskDefinition } from "./diamond";
import { ellipseMaskDefinition } from "./ellipse";
import { heartMaskDefinition } from "./heart";
import { rectangleMaskDefinition } from "./rectangle";
import { splitMaskDefinition } from "./split";
import { starMaskDefinition } from "./star";
import { textMaskDefinition } from "./text";
import { freeformMaskDefinition } from "../../freeform/definition";
import {
	MinusSignIcon,
	PanelRightDashedIcon,
	SquareIcon,
	CircleIcon,
	FavouriteIcon,
	DiamondIcon,
	StarsIcon,
	TextFontIcon,
	PenToolAddIcon,
} from "@hugeicons/core-free-icons";

function registerDefaultMask({
	definition,
	icon,
}: {
	definition: MaskDefinitionForRegistration;
	icon: MaskIconProps;
}) {
	if (masksRegistry.has(definition.type)) {
		return;
	}

	masksRegistry.registerMask({ definition, icon });
}

export function registerDefaultMasks(): void {
	registerDefaultMask({
		definition: splitMaskDefinition,
		icon: { icon: PanelRightDashedIcon, strokeWidth: 1 },
	});
	registerDefaultMask({
		definition: cinematicBarsMaskDefinition,
		icon: { icon: MinusSignIcon },
	});
	registerDefaultMask({
		definition: rectangleMaskDefinition,
		icon: { icon: SquareIcon },
	});
	registerDefaultMask({
		definition: ellipseMaskDefinition,
		icon: { icon: CircleIcon },
	});
	registerDefaultMask({
		definition: heartMaskDefinition,
		icon: { icon: FavouriteIcon },
	});
	registerDefaultMask({
		definition: diamondMaskDefinition,
		icon: { icon: DiamondIcon },
	});
	registerDefaultMask({
		definition: starMaskDefinition,
		icon: { icon: StarsIcon },
	});
	registerDefaultMask({
		definition: textMaskDefinition,
		icon: { icon: TextFontIcon },
	});
	registerDefaultMask({
		definition: freeformMaskDefinition,
		icon: { icon: PenToolAddIcon },
	});
}
