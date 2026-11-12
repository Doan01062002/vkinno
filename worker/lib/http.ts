import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, max-age=0',
};

export function ok(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  });
}

export function fail(e: unknown): Response {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Lỗi hệ thống, vui lòng thử lại.';
  let details: unknown;
  if (e instanceof ApiError) {
    ({ status, code, message, details } = e);
  } else if (e instanceof Error && e.message.includes('CHECK constraint failed')) {
    status = 409;
    code = 'STOCK_CONFLICT';
    message = 'Tồn kho không đủ hoặc đã thay đổi, vui lòng tải lại.';
  } else {
    console.error(e);
  }
  const error: Record<string, unknown> = { code, message };
  if (details !== undefined) error.details = details;
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: BASE_HEADERS });
}

function validationError(error: z.ZodError): ApiError {
  return new ApiError(422, 'VALIDATION', 'Dữ liệu không hợp lệ.', z.flattenError(error).fieldErrors);
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>, maxBytes = 524288): Promise<T> {
  const declared = Number(req.headers.get('Content-Length') || '0');
  if (declared > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Định dạng JSON không hợp lệ.');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function parseQuery<T>(url: URL, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}
