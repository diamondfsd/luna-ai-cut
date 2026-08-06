import { describe, expect, it } from "bun:test";
import { evaluateMathExpression } from "../math";

describe("evaluateMathExpression", () => {
	describe("basic arithmetic", () => {
		it("should add numbers", () => {
			expect(evaluateMathExpression({ input: "1+2" })).toBe(3);
			expect(evaluateMathExpression({ input: "10 + 20" })).toBe(30);
		});

		it("should subtract numbers", () => {
			expect(evaluateMathExpression({ input: "5-3" })).toBe(2);
			expect(evaluateMathExpression({ input: "100 - 50" })).toBe(50);
		});

		it("should multiply numbers", () => {
			expect(evaluateMathExpression({ input: "4*5" })).toBe(20);
			expect(evaluateMathExpression({ input: "10 * 10" })).toBe(100);
		});

		it("should divide numbers", () => {
			expect(evaluateMathExpression({ input: "20/4" })).toBe(5);
			expect(evaluateMathExpression({ input: "100 / 10" })).toBe(10);
		});
	});

	describe("operator precedence", () => {
		it("should respect multiplication over addition", () => {
			expect(evaluateMathExpression({ input: "2+3*4" })).toBe(14);
			expect(evaluateMathExpression({ input: "10+5*2" })).toBe(20);
		});

		it("should respect division over subtraction", () => {
			expect(evaluateMathExpression({ input: "10-6/2" })).toBe(7);
		});
	});

	describe("parentheses", () => {
		it("should evaluate expressions in parentheses first", () => {
			expect(evaluateMathExpression({ input: "(2+3)*4" })).toBe(20);
			expect(evaluateMathExpression({ input: "(10-5)*2" })).toBe(10);
		});

		it("should handle nested parentheses", () => {
			expect(evaluateMathExpression({ input: "((2+3)*4)" })).toBe(20);
			expect(evaluateMathExpression({ input: "(1+(2*3))" })).toBe(7);
		});
	});

	describe("decimal numbers", () => {
		it("should handle decimal numbers", () => {
			expect(evaluateMathExpression({ input: "3.5+2.5" })).toBe(6);
			expect(evaluateMathExpression({ input: "10.5 * 2" })).toBe(21);
		});
	});

	describe("negative numbers", () => {
		it("should handle negative numbers", () => {
			expect(evaluateMathExpression({ input: "-5+3" })).toBe(-2);
			expect(evaluateMathExpression({ input: "10+-5" })).toBe(5);
		});
	});

	describe("whitespace handling", () => {
		it("should handle various whitespace", () => {
			expect(evaluateMathExpression({ input: "  1  +  2  " })).toBe(3);
			expect(evaluateMathExpression({ input: "10*   5" })).toBe(50);
		});
	});

	describe("edge cases", () => {
		it("should handle single number", () => {
			expect(evaluateMathExpression({ input: "42" })).toBe(42);
			expect(evaluateMathExpression({ input: "3.14" })).toBe(3.14);
		});

		it("should return null for empty string", () => {
			expect(evaluateMathExpression({ input: "" })).toBeNull();
		});

		it("should return null for invalid characters", () => {
			expect(evaluateMathExpression({ input: "1+2a" })).toBeNull();
			expect(evaluateMathExpression({ input: "alert(1)" })).toBeNull();
			expect(evaluateMathExpression({ input: "1+2; doSomething()" })).toBeNull();
		});

		it("should return null for unbalanced parentheses", () => {
			expect(evaluateMathExpression({ input: "(1+2" })).toBeNull();
			expect(evaluateMathExpression({ input: "1+2)" })).toBeNull();
		});

		it("should return null for division by zero", () => {
			expect(evaluateMathExpression({ input: "1/0" })).toBeNull();
		});

		it("should return null for incomplete expressions", () => {
			expect(evaluateMathExpression({ input: "1+" })).toBeNull();
			expect(evaluateMathExpression({ input: "*2" })).toBeNull();
		});
	});

	describe("security - code injection prevention", () => {
		it("should reject code injection attempts", () => {
			// These would be dangerous with new Function() but are safe here
			expect(evaluateMathExpression({ input: "alert('xss')" })).toBeNull();
			expect(evaluateMathExpression({ input: "process.exit()" })).toBeNull();
			expect(evaluateMathExpression({ input: "require('fs')" })).toBeNull();
			expect(evaluateMathExpression({ input: "eval('1+1')" })).toBeNull();
			expect(evaluateMathExpression({ input: "Function('return 1')()" })).toBeNull();
			expect(evaluateMathExpression({ input: "constructor.constructor('return 1')()" })).toBeNull();
			expect(evaluateMathExpression({ input: "this.toString" })).toBeNull();
			expect(evaluateMathExpression({ input: "__proto__" })).toBeNull();
		});

		it("should reject prototype pollution attempts", () => {
			expect(evaluateMathExpression({ input: "[].constructor" })).toBeNull();
			expect(evaluateMathExpression({ input: "({}).constructor" })).toBeNull();
		});
	});
});
