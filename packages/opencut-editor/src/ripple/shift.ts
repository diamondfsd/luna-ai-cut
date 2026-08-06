import type { TimelineElement } from "@/timeline/types";

export function rippleShiftElements<TElement extends TimelineElement>({
	elements,
	afterTime,
	shiftAmount,
}: {
	elements: TElement[];
	afterTime: number;
	shiftAmount: number;
}): TElement[] {
	return elements.map((element) =>
		element.startTime >= afterTime
			? ({ ...element, startTime: element.startTime - shiftAmount } as TElement)
			: element,
	);
}
