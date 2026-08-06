import { describe, expect, test } from "bun:test";
import {
	coerceParamValue,
	getParamDefaultInterpolation,
	getParamNumericRange,
	getParamValueKind,
} from "@/params";

describe("animated params", () => {
	test("snaps and clamps number params", () => {
		expect(
			coerceParamValue({
				param: {
					key: "intensity",
					label: "Intensity",
					type: "number",
					default: 0,
					min: 0,
					max: 1,
					step: 0.25,
				},
				value: 0.62,
			}),
		).toBe(0.5);

		expect(
			coerceParamValue({
				param: {
					key: "intensity",
					label: "Intensity",
					type: "number",
					default: 0,
					min: 0,
					max: 1,
					step: 0.25,
				},
				value: 1.2,
			}),
		).toBe(1);
	});

	test("rejects NaN and non-number values for number params", () => {
		const param = {
			key: "intensity",
			label: "Intensity",
			type: "number" as const,
			default: 0,
			min: 0,
			max: 1,
			step: 0.25,
		};
		expect(coerceParamValue({ param, value: Number.NaN })).toBeNull();
		expect(coerceParamValue({ param, value: "0.5" })).toBeNull();
		expect(coerceParamValue({ param, value: true })).toBeNull();
	});

	test("passthrough with step <= 0 guard", () => {
		expect(
			coerceParamValue({
				param: {
					key: "x",
					label: "X",
					type: "number",
					default: 0,
					min: 0,
					step: 0,
				},
				value: 0.123,
			}),
		).toBe(0.123);
	});

	test("accepts valid select values", () => {
		const param = {
			key: "blend",
			label: "Blend",
			type: "select" as const,
			default: "normal",
			options: [
				{ value: "normal", label: "Normal" },
				{ value: "multiply", label: "Multiply" },
			],
		};
		expect(coerceParamValue({ param, value: "normal" })).toBe("normal");
		expect(coerceParamValue({ param, value: "multiply" })).toBe("multiply");
	});

	test("rejects select values outside the allowed options", () => {
		expect(
			coerceParamValue({
				param: {
					key: "blend",
					label: "Blend",
					type: "select",
					default: "normal",
					options: [
						{ value: "normal", label: "Normal" },
						{ value: "multiply", label: "Multiply" },
					],
				},
				value: "screen",
			}),
		).toBeNull();
	});

	test("rejects non-string select values", () => {
		const param = {
			key: "blend",
			label: "Blend",
			type: "select" as const,
			default: "normal",
			options: [{ value: "normal", label: "Normal" }],
		};
		expect(coerceParamValue({ param, value: 42 })).toBeNull();
		expect(coerceParamValue({ param, value: null })).toBeNull();
		expect(coerceParamValue({ param, value: undefined })).toBeNull();
	});

	test("boolean params accept booleans and reject other types", () => {
		const param = {
			key: "visible",
			label: "Visible",
			type: "boolean" as const,
			default: true,
		};
		expect(coerceParamValue({ param, value: true })).toBe(true);
		expect(coerceParamValue({ param, value: false })).toBe(false);
		expect(coerceParamValue({ param, value: 1 })).toBeNull();
		expect(coerceParamValue({ param, value: "true" })).toBeNull();
	});

	test("color params accept strings and reject other types", () => {
		const param = {
			key: "fill",
			label: "Fill",
			type: "color" as const,
			default: "#ffffff",
		};
		expect(coerceParamValue({ param, value: "#ff0000" })).toBe("#ff0000");
		expect(coerceParamValue({ param, value: 0xff0000 })).toBeNull();
		expect(coerceParamValue({ param, value: null })).toBeNull();
	});

	test("getAnimationParamValueKind maps param type to binding kind", () => {
		expect(
			getParamValueKind({
				param: {
					key: "n",
					label: "N",
					type: "number",
					default: 0,
					min: 0,
					step: 1,
				},
			}),
		).toBe("number");
		expect(
			getParamValueKind({
				param: { key: "c", label: "C", type: "color", default: "#fff" },
			}),
		).toBe("color");
		expect(
			getParamValueKind({
				param: { key: "b", label: "B", type: "boolean", default: false },
			}),
		).toBe("discrete");
		expect(
			getParamValueKind({
				param: {
					key: "s",
					label: "S",
					type: "select",
					default: "a",
					options: [{ value: "a", label: "A" }],
				},
			}),
		).toBe("discrete");
	});

	test("getAnimationParamDefaultInterpolation is linear for continuous, hold for discrete", () => {
		expect(
			getParamDefaultInterpolation({
				param: {
					key: "n",
					label: "N",
					type: "number",
					default: 0,
					min: 0,
					step: 1,
				},
			}),
		).toBe("linear");
		expect(
			getParamDefaultInterpolation({
				param: { key: "c", label: "C", type: "color", default: "#fff" },
			}),
		).toBe("linear");
		expect(
			getParamDefaultInterpolation({
				param: { key: "b", label: "B", type: "boolean", default: false },
			}),
		).toBe("hold");
		expect(
			getParamDefaultInterpolation({
				param: {
					key: "s",
					label: "S",
					type: "select",
					default: "a",
					options: [{ value: "a", label: "A" }],
				},
			}),
		).toBe("hold");
	});

	test("getAnimationParamNumericRange returns spec for number params, undefined otherwise", () => {
		expect(
			getParamNumericRange({
				param: {
					key: "intensity",
					label: "Intensity",
					type: "number",
					default: 0.5,
					min: 0,
					max: 1,
					step: 0.1,
				},
			}),
		).toEqual({ min: 0, max: 1, step: 0.1 });
		expect(
			getParamNumericRange({
				param: { key: "c", label: "C", type: "color", default: "#fff" },
			}),
		).toBeUndefined();
		expect(
			getParamNumericRange({
				param: { key: "b", label: "B", type: "boolean", default: false },
			}),
		).toBeUndefined();
	});
});
