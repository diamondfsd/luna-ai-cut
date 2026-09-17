/**
 * Generates a unique ID string using timestamp and random values.
 *
 * @returns Unique ID in format "timestamp-randomhash"
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Clamps a value between minimum and maximum bounds.
 *
 * @param value - The value to clamp
 * @param min - Minimum bound (inclusive)
 * @param max - Maximum bound (inclusive)
 * @returns Clamped value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Creates a deep clone of an object using JSON serialization.
 * Works for plain objects and arrays but not for functions, Maps, Sets, etc.
 *
 * @param obj - Object to clone
 * @returns Deep cloned copy of the object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
export * from "./serialization";
export * from "./immutable-updates";
