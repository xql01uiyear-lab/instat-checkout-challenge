/**
 * Single normalized error shape for the whole app.
 *
 * Every failure — a dropped connection, a non-2xx HTTP status, or an unreadable
 * body — is converted here into one discriminated union so components never
 * inspect a raw `Response` or re-implement `catch`/status handling. A payment
 * that comes back `failed` on HTTP 200 is NOT an error: it is domain data and
 * flows through as a normal result.
 */
export type FieldIssue = { readonly path: string; readonly message: string };

export type ApiErrorInfo =
  | { readonly kind: 'network'; readonly message: string }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly code: string;
      readonly message: string;
      readonly fields?: readonly FieldIssue[];
    }
  | { readonly kind: 'parse'; readonly message: string };

export class ApiError extends Error {
  constructor(readonly info: ApiErrorInfo) {
    super(info.message);
    this.name = 'ApiError';
  }

  /** Domain code for HTTP failures (e.g. `CART_VERSION_CONFLICT`), else undefined. */
  get code(): string | undefined {
    return this.info.kind === 'http' ? this.info.code : undefined;
  }

  get status(): number | undefined {
    return this.info.kind === 'http' ? this.info.status : undefined;
  }

  /** True when a network error means the response may or may not have been applied. */
  get isNetwork(): boolean {
    return this.info.kind === 'network';
  }
}

/** Narrow any thrown value to ApiError, wrapping unexpected throws once. */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError({ kind: 'network', message: 'Запрос отменён.' });
  }
  return new ApiError({
    kind: 'network',
    message: error instanceof Error ? error.message : 'Неизвестная ошибка.',
  });
}
