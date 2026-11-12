import type { Env } from '../lib/env';
import { hmacSign, timingSafeCompare } from '../lib/crypto';
import { ApiError } from '../lib/http';

export type Role = 'ADMIN' | 'STAFF';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface AdminCtx {
  env: Env;
  ctx: ExecutionContext;
  req: Request;
  url: URL;
  user: SessionUser;
  params: Record<string, string>;
}

export const COOKIE_NAME = 'vk_admin';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const PBKDF2_ITERATIONS = 100000;

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(pw: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

/** `pbkdf2$100000$<saltB64>$<hashB64>` — PBKDF2-SHA256, muối 16 byte. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pw, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  try {
    salt = b64decode(parts[2]);
  } catch {
    return false;
  }
  const hash = b64encode(await pbkdf2(pw, salt, iterations));
  return timingSafeCompare(hash, parts[3]);
}

/** Token `"<userId>.<expMs>.<hexSig>"`, sống 7 ngày. */
export async function signSession(
  userId: number,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const payload = `${userId}.${nowMs + SESSION_TTL_MS}`;
  return `${payload}.${await hmacSign(payload, secret)}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const p = part.trim();
    if (p.startsWith(`${name}=`)) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

/** Đọc người dùng từ cookie hợp lệ; luôn tra DB và yêu cầu `is_active = 1`. */
export async function readSession(req: Request, env: Env): Promise<SessionUser | null> {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [idStr, expStr, sig] = parts;
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isInteger(id) || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = await hmacSign(`${idStr}.${expStr}`, secret);
  if (!(await timingSafeCompare(sig, expected))) return null;
  const row = await env.DB.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ? AND is_active = 1',
  )
    .bind(id)
    .first<SessionUser>();
  return row ?? null;
}

export function requireRole(user: SessionUser, role: Role): void {
  if (role === 'ADMIN' && user.role !== 'ADMIN') {
    throw new ApiError(403, 'FORBIDDEN', 'Bạn không đủ quyền thực hiện thao tác này.');
  }
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
