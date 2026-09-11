import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, asApiError } from '../api/errors';

/**
 * Explicit async state as a discriminated union, so impossible combinations
 * (loading && error) can't be represented. Shared by every screen instead of
 * ad-hoc isLoading/isError booleans.
 */
export type AsyncState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly error: ApiError };

export type Result<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * Load a resource when `deps` change. The previous load is aborted, and a late
 * response from a superseded load is discarded, so stale data never wins.
 */
export function useAsyncData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): { state: AsyncState<T>; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loaderRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data });
      },
      (error) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: asApiError(error) });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

/**
 * Imperative async action (mutations). Guards against concurrent runs (double
 * click), tracks state, ignores completion after unmount, and returns a
 * normalized {@link Result} so callers branch on the outcome without writing
 * their own try/catch or error parsing.
 */
export function useMutation<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): { run: (...args: Args) => Promise<Result<T>>; state: AsyncState<T>; reset: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' });
  const mounted = useMountedRef();
  const inFlight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(
    async (...args: Args): Promise<Result<T>> => {
      if (inFlight.current) {
        return { ok: false, error: new ApiError({ kind: 'network', message: 'Уже выполняется.' }) };
      }
      inFlight.current = true;
      setState({ status: 'loading' });
      try {
        const data = await fnRef.current(...args);
        if (mounted.current) setState({ status: 'success', data });
        return { ok: true, data };
      } catch (error) {
        const apiError = asApiError(error);
        if (mounted.current) setState({ status: 'error', error: apiError });
        return { ok: false, error: apiError };
      } finally {
        inFlight.current = false;
      }
    },
    [mounted],
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { run, state, reset };
}
