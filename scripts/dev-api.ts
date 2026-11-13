/// <reference types="@cloudflare/workers-types" />
// Dev cục bộ không cần workerd (bị Windows Application Control chặn): chạy handler fetch của Worker
// trên Node, D1 = node:sqlite (.dev/local.sqlite), R2 trong bộ nhớ, ASSETS = thư mục dist/ (nếu đã build).
// Dùng: npm run dev:api  (cổng 8787; `npm run dev` proxy /api và /files sang đây).
// Lần đầu: đặt DEV_ADMIN_EMAIL và DEV_ADMIN_PASSWORD (biến môi trường hoặc file .dev.vars)
// để tạo tài khoản ADMIN khi bảng users trống.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import worker, { type Env } from '../worker/index';
import { hashPassword } from '../worker/admin/auth';
import { applyMigrations, createTestD1 } from '../test/d1-sqlite';
import { createMemoryR2 } from '../test/r2-memory';

const PORT = Number(process.env.DEV_API_PORT || 8787);
const ROOT = process.cwd();
const DEV_DIR = join(ROOT, '.dev');
const DIST_DIR = join(ROOT, 'dist');

/** Áp các migration chưa chạy (ghi vào bảng d1_migrations như wrangler) — chạy lại nhiều lần vẫn an toàn. */
async function migrate(db: D1Database): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const done = new Set(
    (await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map((r) => r.name),
  );
  const pending = readdirSync(join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql') && !done.has(f))
    .sort();
  for (const name of pending) {
    await applyMigrations(db, { filter: (f) => f === name });
    await db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
  }
  return pending;
}

async function seedAdmin(db: D1Database): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;
  const email = process.env.DEV_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      '[dev-api] Chưa có tài khoản nào. Đặt DEV_ADMIN_EMAIL và DEV_ADMIN_PASSWORD rồi chạy lại để tạo ADMIN.',
    );
    return;
  }
  await db
    .prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'ADMIN', ?)")
    .bind(email, 'Quản trị (dev)', await hashPassword(password))
    .run();
  console.log(`[dev-api] Đã tạo ADMIN ${email}.`);
}

/** Bí mật phiên dev sinh một lần, lưu ở .dev/ để đăng nhập còn hiệu lực sau khi khởi động lại. */
function devSecret(): string {
  const file = join(DEV_DIR, 'session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret);
  return secret;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** ASSETS giả: phục vụ dist/ (thư mục → index.html); ngoài dist hoặc không có thì 404. */
const assets = {
  async fetch(input: Request | string): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input.url);
    let file = normalize(join(DIST_DIR, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST_DIR + sep) && file !== DIST_DIR) return new Response('Not found', { status: 404 });
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      return new Response(existsSync(DIST_DIR) ? 'Not found' : 'Chưa build: chạy npm run build', { status: 404 });
    }
    return new Response(readFileSync(file), {
      headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' },
    });
  },
} as unknown as Fetcher;

/** Dựng lại URL gốc khi đi qua proxy Vite (xfwd) để kiểm tra Origin khớp trình duyệt. */
function requestUrl(req: IncomingMessage): string {
  const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || `localhost:${PORT}`;
  const proto = first(req.headers['x-forwarded-proto']) || 'http';
  return `${proto}://${host}${req.url ?? '/'}`;
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const value of Array.isArray(v) ? v : [v]) headers.append(k, value);
  }
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', req.socket.remoteAddress ?? '127.0.0.1');
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(requestUrl(req), {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    // @ts-expect-error duplex là bắt buộc trên Node khi thân là stream, chưa có trong kiểu RequestInit.
    duplex: hasBody ? 'half' : undefined,
  });
}

async function writeResponse(res: ServerResponse, out: Response, method: string): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  out.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value;
  });
  const cookies = out.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(out.status, headers);
  if (method === 'HEAD' || !out.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await out.arrayBuffer()));
}

async function main(): Promise<void> {
  if (existsSync(join(ROOT, '.dev.vars'))) process.loadEnvFile(join(ROOT, '.dev.vars'));
  mkdirSync(DEV_DIR, { recursive: true });
  const DB = createTestD1(join(DEV_DIR, 'local.sqlite'));
  const applied = await migrate(DB);
  if (applied.length) console.log(`[dev-api] Đã áp migration: ${applied.join(', ')}`);
  await seedAdmin(DB);

  const env: Env = {
    DB,
    FILES: createMemoryR2(),
    ASSETS: assets,
    ADMIN_SESSION_SECRET: devSecret(),
  };

  const server = createServer(async (req, res) => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    try {
      const out = await worker.fetch(toRequest(req), env, ctx);
      await writeResponse(res, out, req.method ?? 'GET');
    } catch (e) {
      console.error('[dev-api] Lỗi xử lý', req.method, req.url, e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Lỗi máy chủ dev');
    }
    Promise.allSettled(pending).then((results) => {
      for (const r of results) if (r.status === 'rejected') console.error('[dev-api] waitUntil lỗi:', r.reason);
    });
  });

  server.listen(PORT, () => {
    console.log(`[dev-api] Worker chạy tại http://localhost:${PORT} (DB: ${resolve(DEV_DIR, 'local.sqlite')})`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
