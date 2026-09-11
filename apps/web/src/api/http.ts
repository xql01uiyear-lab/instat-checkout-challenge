import { ApiError, asApiError, type FieldIssue } from './errors';
import { clearToken, getToken, setToken } from './session';

/**
 * The one place that talks to the network. Responsibilities live here and
 * nowhere else: base URL, common headers, auth, JSON serialization, status
 * checks, empty-body handling, envelope unwrapping, and error normalization.
 * Callers get typed `data` (already unwrapped from `{ data, meta, links }`) plus
 * the raw `Response` for the few headers that matter (Retry-After on polling).
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type RequestOptions = {
  readonly method?: Method;
  /** JSON-serializable body. Presence adds the `Content-Type` header. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  /** Attach the session bearer token. Default true. */
  readonly auth?: boolean;
};

export type ApiResponse<T> = { readonly data: T; readonly res: Response };

const DEFAULT_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Проверьте формат и поля запроса.',
  401: 'Сессия недействительна.',
  404: 'Ресурс не найден.',
  409: 'Данные изменились. Обновите и повторите.',
  413: 'Слишком большой запрос.',
  415: 'Неподдерживаемый формат запроса.',
  422: 'Запрос не может быть обработан.',
  500: 'Сервис временно недоступен.',
};

async function toHttpError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = DEFAULT_MESSAGES[res.status] ?? 'Ошибка запроса.';
  let fields: readonly FieldIssue[] | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; fields?: FieldIssue[] };
    };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
    if (body.error?.fields?.length) fields = body.error.fields;
  } catch {
    /* non-JSON error body — keep status-based defaults */
  }
  return new ApiError({
    kind: 'http',
    status: res.status,
    code,
    message,
    ...(fields ? { fields } : {}),
  });
}

async function send<T>(path: string, opts: RequestOptions): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers, idempotencyKey, signal, auth = true } = opts;
  const hasBody = body !== undefined;
  const requestHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
  if (hasBody) requestHeaders['Content-Type'] = 'application/json';
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey;
  if (auth) {
    const token = getToken();
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: requestHeaders,
      body: hasBody ? JSON.stringify(body) : undefined,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw asApiError(error);
  }

  if (!res.ok) throw await toHttpError(res);
  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return { data: undefined as T, res };
  }
  try {
    const json = (await res.json()) as { data: T };
    return { data: json.data, res };
  } catch {
    throw new ApiError({ kind: 'parse', message: 'Не удалось разобрать ответ сервера.' });
  }
}

/** Public: create a guest session and remember its token. */
export async function createSession(): Promise<void> {
  const { data } = await send<{ token: string }>('/api/sessions', {
    method: 'POST',
    body: {},
    auth: false,
  });
  setToken(data.token);
}

async function refreshSession(): Promise<void> {
  clearToken();
  await createSession();
}

let sessionBootstrap: Promise<void> | null = null;

/**
 * Ensure a token exists before the first authorized call. Concurrent callers
 * (e.g. React StrictMode's double-invoked effects) share one in-flight request
 * so only a single guest session is created.
 */
export function ensureSession(): Promise<void> {
  if (getToken()) return Promise.resolve();
  sessionBootstrap ??= createSession().finally(() => {
    sessionBootstrap = null;
  });
  return sessionBootstrap;
}

/**
 * Send a request. On a 401 caused by a stale/reset session, transparently
 * recreate the session once and retry — so a server data reset never surfaces
 * as a broken UI. Any other failure is thrown as a normalized {@link ApiError}.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  try {
    return await send<T>(path, opts);
  } catch (error) {
    const recoverable =
      opts.auth !== false &&
      error instanceof ApiError &&
      error.status === 401 &&
      (error.code === 'SESSION_INVALID' || error.code === 'SESSION_REQUIRED');
    if (!recoverable) throw error;
    await refreshSession();
    return await send<T>(path, opts);
  }
}
