import { z } from 'zod';
import type { Env } from '../lib/env';
import { ApiError, fail, ok, parseBody } from '../lib/http';
import { auditStmt } from './audit';
import {
  clearSessionCookie,
  hashPassword,
  readSession,
  requireRole,
  sessionCookie,
  signSession,
  verifyPassword,
  type AdminCtx,
  type Role,
  type SessionUser,
} from './auth';
import { redact } from './redact';

type Handler = (c: AdminCtx) => Promise<Response>;

interface RouteDef {
  method: string;
  segments: string[];
  handler: Handler;
  role?: Role;
  public?: boolean;
}

const routes: RouteDef[] = [];

/** Đăng ký route; `pattern` dạng `"/orders/:id/transition"` (không gồm `/api/admin`). */
export function route(
  method: string,
  pattern: string,
  handler: Handler,
  opts: { role?: Role; public?: boolean } = {},
): void {
  routes.push({
    method: method.toUpperCase(),
    segments: pattern.split('/').filter(Boolean),
    handler,
    role: opts.role,
    public: opts.public,
  });
}

function match(method: string, path: string): { def: RouteDef; params: Record<string, string> } | null {
  const segs = path.split('/').filter(Boolean);
  for (const def of routes) {
    if (def.method !== method || def.segments.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let hit = true;
    for (let i = 0; i < segs.length; i++) {
      const p = def.segments[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) {
        hit = false;
        break;
      }
    }
    if (hit) return { def, params };
  }
  return null;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ANON: SessionUser = { id: 0, email: '', name: '', role: 'STAFF' };

async function redactResponse(res: Response, role: Role): Promise<Response> {
  if (role !== 'STAFF' || !(res.headers.get('Content-Type') || '').includes('application/json')) return res;
  const body = (await res.json()) as { ok?: boolean; data?: unknown };
  if (body && body.ok === true && 'data' in body) body.data = redact(body.data, role);
  return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
}

export async function handleAdmin(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    if (MUTATING.has(method) && req.headers.get('Origin') !== url.origin) {
      throw new ApiError(403, 'BAD_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
    }
    const path = url.pathname.replace(/^\/api\/admin/, '');
    const hit = match(method, path);
    if (!hit) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy.');
    const { def, params } = hit;

    let user = ANON;
    if (!def.public) {
      const session = await readSession(req, env);
      if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.');
      user = session;
      if (def.role) requireRole(user, def.role);
    }
    const res = await def.handler({ env, ctx, req, url, user, params });
    return def.public ? res : await redactResponse(res, user.role);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Xác thực
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;
// Băm giả để thời gian phản hồi không lộ email có tồn tại hay không.
const DUMMY_HASH = `pbkdf2$100000$${'A'.repeat(22)}==$${'A'.repeat(43)}=`;

const EXPIRED_SQL = `(CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', window_start) AS INTEGER)) >= ${ATTEMPT_WINDOW_SECONDS}`;

route(
  'POST',
  '/auth/login',
  async ({ env, req }) => {
    if (!env.ADMIN_SESSION_SECRET) {
      throw new ApiError(500, 'NOT_CONFIGURED', 'Máy chủ chưa cấu hình phiên đăng nhập.');
    }
    const { email, password } = await parseBody(
      req,
      z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(200) }),
      4096,
    );
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `${ip}|${email.toLowerCase()}`;

    const attempt = await env.DB.prepare(
      `SELECT count, ${EXPIRED_SQL} AS expired FROM login_attempts WHERE key = ?`,
    )
      .bind(key)
      .first<{ count: number; expired: number }>();
    if (attempt && !attempt.expired && attempt.count >= MAX_FAILED_ATTEMPTS) {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút.');
    }

    const row = await env.DB.prepare(
      'SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = ? AND is_active = 1',
    )
      .bind(email.toLowerCase())
      .first<SessionUser & { password_hash: string }>();
    const good = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);

    if (!row || !good) {
      await env.DB.prepare(
        `INSERT INTO login_attempts (key, count, window_start) VALUES (?, 1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN ${EXPIRED_SQL} THEN 1 ELSE count + 1 END,
           window_start = CASE WHEN ${EXPIRED_SQL} THEN datetime('now') ELSE window_start END`,
      )
        .bind(key)
        .run();
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key),
      env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(row.id),
      auditStmt(env.DB, row.id, 'login', 'user', row.id),
    ]);
    const token = await signSession(row.id, env.ADMIN_SESSION_SECRET);
    return ok({ id: row.id, email: row.email, name: row.name, role: row.role }, 200, {
      'Set-Cookie': sessionCookie(token),
    });
  },
  { public: true },
);

route('POST', '/auth/logout', async () => ok({}, 200, { 'Set-Cookie': clearSessionCookie() }), {
  public: true,
});

route('GET', '/auth/me', async ({ user }) => ok(user));

route('POST', '/auth/change-password', async ({ env, req, user }) => {
  const { current, next } = await parseBody(
    req,
    z.object({ current: z.string().min(1).max(200), next: z.string().min(8).max(200) }),
    4096,
  );
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng.');
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), user.id),
    auditStmt(env.DB, user.id, 'user.change_password', 'user', user.id),
  ]);
  return ok({});
});
