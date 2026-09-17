export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { success: true; data: T } {
  return result.success;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { success: false; error: E } {
  return !result.success;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.data;
  }
  throw result.error instanceof Error
    ? result.error
    : new Error(String(result.error));
}

export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.success ? result.data : defaultValue;
}

export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (result.success) {
    return { success: true, data: fn(result.data) };
  }
  return result;
}

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  if (!result.success) {
    return { success: false, error: fn(result.error) };
  }
  return result;
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (result.success) {
    return fn(result.data);
  }
  return result;
}

export async function fromPromise<T>(
  promise: Promise<T>,
): Promise<Result<T, Error>> {
  try {
    const data = await promise;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function fromNullable<T>(
  value: T | null | undefined,
  errorMsg: string,
): Result<T, Error> {
  if (value === null || value === undefined) {
    return { success: false, error: new Error(errorMsg) };
  }
  return { success: true, data: value };
}

export function combine<T extends Result<unknown, unknown>[]>(
  results: [...T],
): Result<
  { [K in keyof T]: T[K] extends Result<infer U, unknown> ? U : never },
  Error
> {
  const data: unknown[] = [];
  for (const result of results) {
    if (!result.success) {
      return result as Result<never, Error>;
    }
    data.push(result.data);
  }
  return {
    success: true,
    data: data as {
      [K in keyof T]: T[K] extends Result<infer U, unknown> ? U : never;
    },
  };
}
