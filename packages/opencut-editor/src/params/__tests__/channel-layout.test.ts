import { describe, expect, test } from "bun:test";
import { formatLinearRgba } from "@/params";

describe("channel layout", () => {
	test("formats linear animated colors as hex", () => {
		expect(formatLinearRgba({ color: { r: 1, g: 0, b: 0, a: 1 } })).toBe(
			"#ff0000",
		);
	});
});
