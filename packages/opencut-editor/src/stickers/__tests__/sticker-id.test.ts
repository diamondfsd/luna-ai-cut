import { describe, expect, test } from "bun:test";
import { buildStickerId, parseStickerId } from "../sticker-id";

describe("sticker-id strict mode", () => {
	test("parses provider-prefixed IDs", () => {
		expect(parseStickerId({ stickerId: "flags:US" })).toEqual({
			providerId: "flags",
			providerValue: "US",
		});
		expect(parseStickerId({ stickerId: "shapes:circle" })).toEqual({
			providerId: "shapes",
			providerValue: "circle",
		});
	});

	test("throws for IDs without provider prefix", () => {
		expect(() => parseStickerId({ stickerId: "home" })).toThrow();
	});

	test("throws for malformed IDs", () => {
		expect(() => parseStickerId({ stickerId: "" })).toThrow();
		expect(() => parseStickerId({ stickerId: "flags:" })).toThrow();
		expect(() => parseStickerId({ stickerId: ":mdi:home" })).toThrow();
	});

	test("builds sticker IDs unchanged", () => {
		expect(
			buildStickerId({
				providerId: "flags",
				providerValue: "US",
			}),
		).toBe("flags:US");
	});
});
