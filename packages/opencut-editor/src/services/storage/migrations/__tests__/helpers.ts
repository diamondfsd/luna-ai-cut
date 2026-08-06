/**
 * Type-safe accessors for navigating migration output.
 *
 * Migrations input/output `Record<string, unknown>` because they handle
 * potentially malformed data from older versions. Tests need to inspect
 * specific properties of the migrated result without using type assertions.
 *
 * These helpers narrow through type guards (Array.isArray + a record
 * predicate), so the file contains no unsafe assertions despite turning
 * unknown into concrete shapes.
 */

function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`Expected record, got ${describe(value)}`);
	}
	return value;
}

export function asArray(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`Expected array, got ${describe(value)}`);
	}
	return value;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
	return asArray(value).map(asRecord);
}
