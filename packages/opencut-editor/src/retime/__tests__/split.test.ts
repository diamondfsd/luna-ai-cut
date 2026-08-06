import { describe, expect, test } from "bun:test";
import {
	getSourceSpanAtClipTime,
	splitRetimeAtClipTime,
} from "@/retime";
import type { RetimeConfig } from "@/timeline";

describe("retime split", () => {
	test("measures source span at a clip time", () => {
		const retime: RetimeConfig = { rate: 2 };
		expect(getSourceSpanAtClipTime({ clipTime: 5, retime })).toBe(10);
	});

	test("returns zero for non-positive clip time", () => {
		expect(getSourceSpanAtClipTime({ clipTime: 0 })).toBe(0);
		expect(getSourceSpanAtClipTime({ clipTime: -1 })).toBe(0);
	});

	test("passes the same retime to both halves when splitting", () => {
		const retime: RetimeConfig = { rate: 1.5 };
		const result = splitRetimeAtClipTime({ retime, splitClipTime: 3 });
		expect(result.left).toBe(retime);
		expect(result.right).toBe(retime);
	});

	test("returns undefined on both sides when no retime", () => {
		const result = splitRetimeAtClipTime({ splitClipTime: 3 });
		expect(result.left).toBeUndefined();
		expect(result.right).toBeUndefined();
	});
});
