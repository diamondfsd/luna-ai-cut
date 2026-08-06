import { describe, expect, test } from "bun:test";
import {
	getClipTimeAtSourceTime,
	getEffectiveRateAt,
	getSourceTimeAtClipTime,
	getTimelineDurationForSourceSpan,
} from "@/retime";
import type { RetimeConfig } from "@/timeline";

const twoX: RetimeConfig = { rate: 2 };
const halfX: RetimeConfig = { rate: 0.5 };

describe("retime resolve", () => {
	test("maps clip time to source time at 2x speed", () => {
		expect(getSourceTimeAtClipTime({ clipTime: 5, retime: twoX })).toBe(10);
	});

	test("maps clip time to source time at 0.5x speed", () => {
		expect(getSourceTimeAtClipTime({ clipTime: 4, retime: halfX })).toBe(2);
	});

	test("returns clip time unchanged when no retime", () => {
		expect(getSourceTimeAtClipTime({ clipTime: 7 })).toBe(7);
	});

	test("inverts source time back to clip time at 2x speed", () => {
		expect(getClipTimeAtSourceTime({ sourceTime: 10, retime: twoX })).toBe(5);
	});

	test("returns effective rate", () => {
		expect(getEffectiveRateAt({ retime: twoX })).toBe(2);
		expect(getEffectiveRateAt({})).toBe(1);
	});

	test("derives timeline duration for a visible source span", () => {
		expect(
			getTimelineDurationForSourceSpan({ sourceSpan: 10, retime: twoX }),
		).toBe(5);
		expect(
			getTimelineDurationForSourceSpan({ sourceSpan: 10, retime: halfX }),
		).toBe(20);
	});

	test("clamps invalid rates to 1", () => {
		expect(getSourceTimeAtClipTime({ clipTime: 5, retime: { rate: 0 } })).toBe(
			5,
		);
		expect(
			getSourceTimeAtClipTime({ clipTime: 5, retime: { rate: -1 } }),
		).toBe(5);
	});

	test("caps retime rates above 5x", () => {
		expect(getSourceTimeAtClipTime({ clipTime: 5, retime: { rate: 100 } })).toBe(
			25,
		);
		expect(
			getTimelineDurationForSourceSpan({ sourceSpan: 10, retime: { rate: 100 } }),
		).toBe(2);
	});
});
