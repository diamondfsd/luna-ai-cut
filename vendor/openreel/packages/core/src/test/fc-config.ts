import * as fc from "fast-check";

export const DEFAULT_NUM_RUNS = 100;

export const defaultFcParams = {
  numRuns: DEFAULT_NUM_RUNS,
  verbose: false,
  endOnFailure: true,
} as const;

export const fcConfig = defaultFcParams;

export function runProperty<T>(
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  params: fc.Parameters<[T]> = {},
): void {
  fc.assert(fc.property(arbitrary, predicate), {
    ...defaultFcParams,
    ...params,
  });
}

export async function runAsyncProperty<T>(
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => Promise<boolean | void>,
  params: fc.Parameters<[T]> = {},
): Promise<void> {
  await fc.assert(fc.asyncProperty(arbitrary, predicate), {
    ...defaultFcParams,
    ...params,
  });
}

// Re-export fast-check for convenience
export { fc };
