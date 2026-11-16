// Khoá Gemini nhập trong trang quản trị: lưu app_settings đã mã hoá AES-GCM (không bao giờ lưu chữ thường,
// vì D1 được sao lưu ra file). Khoá mã hoá dẫn xuất từ ADMIN_SESSION_SECRET qua HKDF-SHA256.
// Thứ tự dùng: khoá nhập trong admin (giải mã được) → env.GEMINI_API_KEY → không có.
import type { Env } from '../lib/env';

export const GEMINI_KEY_SETTING = 'blog.gemini_key_enc';
const HKDF_INFO = 'vkinno/gemini-key';
const HKDF_SALT = 'vkinno-gemini-key-v1';
const enc = new TextEncoder();

/** Định dạng khoá chấp nhận (khoá Google AI Studio hiện dạng "AIza…" 39 ký tự; nới rộng cho dạng mới). */
export const GEMINI_KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(HKDF_INFO) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Mã hoá → "base64(iv).base64(ciphertext+tag)". */
export async function encryptGeminiKey(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain));
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

/** Giải mã; sai bí mật / dữ liệu hỏng → null. */
export async function decryptGeminiKey(stored: string, secret: string): Promise<string | null> {
  const [ivB64, ctB64, extra] = stored.split('.');
  if (!ivB64 || !ctB64 || extra !== undefined) return null;
  try {
    const iv = unb64(ivB64);
    if (iv.length !== 12) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(secret), unb64(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export interface GeminiKey {
  key: string;
  source: 'admin' | 'env';
}

/** Khoá đang dùng: admin (giải mã được) ưu tiên, sau đó biến môi trường. */
export async function getGeminiKey(env: Env): Promise<GeminiKey | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(GEMINI_KEY_SETTING)
    .first<{ value: string }>();
  if (row?.value && env.ADMIN_SESSION_SECRET) {
    const key = await decryptGeminiKey(row.value, env.ADMIN_SESSION_SECRET);
    if (key) return { key, source: 'admin' };
  }
  if (env.GEMINI_API_KEY) return { key: env.GEMINI_API_KEY, source: 'env' };
  return null;
}

/** 4 ký tự cuối để nhận diện khoá trên giao diện. */
export function last4(key: string): string {
  return key.slice(-4);
}
