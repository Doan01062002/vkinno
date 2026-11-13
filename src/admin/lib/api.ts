// Client gọi /api/admin/*: cookie phiên cùng gốc, lỗi chuẩn hoá thành ApiClientError.

export const API_PREFIX = '/api/admin';
export const LOGIN_PATH = '/quan-tri/dang-nhap';

/** Dạng danh sách chung của API quản trị. */
export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiInit extends Omit<RequestInit, 'body'> {
  /** Thân JSON (tự đặt Content-Type). */
  json?: unknown;
  /** Thân thô (FormData khi tải ảnh…). Bỏ qua nếu có `json`. */
  body?: BodyInit | null;
  /** Tham số query; giá trị rỗng/undefined/null bị bỏ. */
  query?: Record<string, QueryValue>;
}

/** Lỗi API đã chuẩn hoá: `status` HTTP (0 = mất kết nối), `code` máy đọc, `message` tiếng Việt. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type UnauthorizedHandler = (loginPath: string) => void;

let onUnauthorized: UnauthorizedHandler = (to) => {
  if (typeof window !== 'undefined' && window.location.pathname !== to) window.location.assign(to);
};

/** Thay hành động khi phiên hết hạn (App gắn `navigate` của react-router; test gắn mock). */
export function setUnauthorizedHandler(fn: UnauthorizedHandler): void {
  onUnauthorized = fn;
}

/** Ghép query, bỏ giá trị rỗng. */
export function buildQuery(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Gọi `/api/admin<path>` và trả `data` của `{ ok:true, data }`.
 * Lỗi → ném `ApiClientError`; 401 (trừ đăng nhập) → gọi handler chuyển về trang đăng nhập.
 */
export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, query, body, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders);
  let payload: BodyInit | null | undefined = body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(json);
  }
  headers.set('Accept', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}${buildQuery(query)}`, {
      ...rest,
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiClientError(0, 'NETWORK', 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng.');
  }

  const parsed = (await readJson(res)) as
    | { ok: true; data: T }
    | { ok: false; error?: { code?: string; message?: string; details?: unknown } }
    | null;

  if (res.ok && parsed && parsed.ok === true) return parsed.data;

  const error = parsed && parsed.ok === false ? parsed.error : undefined;
  const err = new ApiClientError(
    res.status,
    error?.code ?? `HTTP_${res.status}`,
    error?.message ?? `Lỗi máy chủ (${res.status}). Vui lòng thử lại.`,
    error?.details,
  );
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized(LOGIN_PATH);
  throw err;
}

/**
 * Lỗi 422 VALIDATION → `{ field: "thông báo đầu tiên" }` để gắn vào form
 * (vd. `Object.entries(fieldErrors(e)).forEach(([k, m]) => setError(k, { message: m }))`).
 */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiClientError) || e.code !== 'VALIDATION' || !e.details || typeof e.details !== 'object') {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.details as Record<string, unknown>)) {
    if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Lấy thông báo tiếng Việt từ lỗi bất kỳ (dùng cho toast). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}
