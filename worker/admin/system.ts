import { z } from 'zod';
import { columnMapSchema } from '../../src/shared/marketplace';
import { pageQuerySchema } from '../../src/shared/schemas';
import { ApiError, ok, parseBody, parseQuery } from '../lib/http';
import { hashPassword } from './auth';
import { auditStmt } from './audit';
import { route } from './router';
import { runBackup } from './scheduled';

// ---------------------------------------------------------------------------
// Cài đặt (chỉ khoá trong danh sách trắng; khoá cũ của website không bao giờ lộ ra)
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);

const SETTING_SCHEMAS = {
  'company.name': text(200),
  'company.address': text(500),
  'company.phone': text(30),
  'company.tax_code': text(20),
  'company.bank_account': text(40),
  'company.bank_name': text(100),
  'print.invoice_footer': text(500),
  'print.show_logo': z.boolean(),
  'telegram.enabled': z.boolean(),
  'import.columns.SHOPEE': columnMapSchema,
  'import.columns.TIKTOK': columnMapSchema,
} as const;

type SettingKey = keyof typeof SETTING_SCHEMAS;
const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

const settingsInput = z
  .strictObject(Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTING_SCHEMAS[k].optional()])))
  .refine((o) => Object.values(o).some((v) => v !== undefined), 'Cần ít nhất một khoá cài đặt');

route(
  'GET',
  '/settings',
  async ({ env }) => {
    const placeholders = SETTING_KEYS.map(() => '?').join(',');
    const rows = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`)
      .bind(...SETTING_KEYS)
      .all<{ key: string; value: string }>();
    const stored = new Map(rows.results.map((r) => [r.key, r.value]));
    const out: Record<string, unknown> = {};
    for (const k of SETTING_KEYS) {
      let v: unknown = null;
      const raw = stored.get(k);
      if (raw !== undefined) {
        try {
          v = JSON.parse(raw);
        } catch {
          v = null;
        }
      }
      out[k] = v;
    }
    return ok(out);
  },
  { role: 'ADMIN' },
);

route(
  'PUT',
  '/settings',
  async ({ env, req, user }) => {
    const input = (await parseBody(req, settingsInput)) as Record<string, unknown>;
    const keys = SETTING_KEYS.filter((k) => input[k] !== undefined);
    await env.DB.batch([
      ...keys.map((k) =>
        env.DB.prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(k, JSON.stringify(input[k])),
      ),
      auditStmt(env.DB, user.id, 'settings.update', 'settings', 'app', { keys }),
    ]);
    return ok({ updated: keys });
  },
  { role: 'ADMIN' },
);

// ---------------------------------------------------------------------------
// Tài khoản
// ---------------------------------------------------------------------------

const USER_COLUMNS = 'id, email, name, role, is_active, last_login_at, created_at';
const passwordSchema = z.string().min(10).max(200);
const nameSchema = z.string().trim().min(1).max(100);
const roleSchema = z.enum(['ADMIN', 'STAFF']);

const userCreateInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: nameSchema,
  role: roleSchema,
  password: passwordSchema,
});
const userUpdateInput = z.object({ name: nameSchema, role: roleSchema, is_active: z.boolean() });

const lastAdmin = () =>
  new ApiError(409, 'LAST_ADMIN', 'Không thể hạ quyền hoặc khoá quản trị viên cuối cùng.');

function parseUserId(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
  return id;
}

route(
  'GET',
  '/users',
  async ({ env }) => {
    const rows = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`).all();
    return ok({ items: rows.results });
  },
  { role: 'ADMIN' },
);

route(
  'POST',
  '/users',
  async ({ env, req, user }) => {
    const input = await parseBody(req, userCreateInput, 4096);
    const hash = await hashPassword(input.password);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)').bind(
          input.email,
          input.name,
          input.role,
          hash,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs (user_id, action, entity, entity_id, detail_json)
           VALUES (?, 'user.create', 'user', (SELECT CAST(id AS TEXT) FROM users WHERE email = ?), ?)`,
        ).bind(user.id, input.email, JSON.stringify({ email: input.email, role: input.role })),
      ]);
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed') && e.message.includes('users.email')) {
        throw new ApiError(409, 'DUPLICATE_EMAIL', 'Email này đã được sử dụng.');
      }
      throw e;
    }
    const row = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).bind(input.email).first();
    return ok(row, 201);
  },
  { role: 'ADMIN' },
);

route(
  'PUT',
  '/users/:id',
  async ({ env, req, user, params }) => {
    const id = parseUserId(params);
    const input = await parseBody(req, userUpdateInput, 4096);
    const active = input.is_active ? 1 : 0;
    const existing = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
    const stmts = [
      env.DB.prepare('UPDATE users SET name = ?, role = ?, is_active = ? WHERE id = ?').bind(
        input.name,
        input.role,
        active,
        id,
      ),
    ];
    if (input.role !== 'ADMIN' || active === 0) {
      // Chốt chặn trong cùng batch: nếu sau khi cập nhật không còn ADMIN hoạt động nào, json() báo lỗi
      // và D1 huỷ cả batch (kể cả nhật ký), nên hai yêu cầu song song cũng không lách được.
      stmts.push(
        env.DB.prepare(
          `SELECT CASE WHEN (SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND is_active = 1) = 0
                       THEN json('LAST_ADMIN') END`,
        ),
      );
    }
    stmts.push(
      auditStmt(env.DB, user.id, 'user.update', 'user', id, {
        name: input.name,
        role: input.role,
        is_active: input.is_active,
      }),
    );
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (e instanceof Error && e.message.includes('malformed JSON')) throw lastAdmin();
      throw e;
    }
    return ok(await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first());
  },
  { role: 'ADMIN' },
);

route(
  'POST',
  '/users/:id/reset-password',
  async ({ env, req, user, params }) => {
    const id = parseUserId(params);
    const { password } = await parseBody(req, z.object({ password: passwordSchema }), 4096);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), id),
      auditStmt(env.DB, user.id, 'user.reset_password', 'user', id),
    ]);
    return ok({});
  },
  { role: 'ADMIN' },
);

// ---------------------------------------------------------------------------
// Nhật ký thao tác
// ---------------------------------------------------------------------------

const vnDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');
const auditQuery = pageQuerySchema.pick({ page: true, page_size: true }).extend({
  user_id: z.coerce.number().int().min(1).optional(),
  entity: z.string().trim().min(1).max(64).optional(),
  from: vnDate.optional(),
  to: vnDate.optional(),
});

route(
  'GET',
  '/audit-logs',
  async ({ env, url }) => {
    const q = parseQuery(url, auditQuery);
    const where = `WHERE (?1 IS NULL OR a.user_id = ?1) AND (?2 IS NULL OR a.entity = ?2)
      AND (?3 IS NULL OR date(a.created_at, '+7 hours') >= ?3) AND (?4 IS NULL OR date(a.created_at, '+7 hours') <= ?4)`;
    const f = [q.user_id ?? null, q.entity ?? null, q.from ?? null, q.to ?? null];
    const [items, total] = await env.DB.batch([
      env.DB.prepare(
        `SELECT a.id, a.user_id, u.name AS user_name, a.action, a.entity, a.entity_id, a.detail_json, a.created_at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where}
         ORDER BY a.id DESC LIMIT ?5 OFFSET ?6`,
      ).bind(...f, q.page_size, (q.page - 1) * q.page_size),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${where}`).bind(...f),
    ]);
    return ok({
      items: items.results,
      total: (total.results[0] as { n: number }).n,
      page: q.page,
      page_size: q.page_size,
    });
  },
  { role: 'ADMIN' },
);

// ---------------------------------------------------------------------------
// Sao lưu
// ---------------------------------------------------------------------------

route(
  'POST',
  '/backup/run',
  async ({ env, user }) => {
    const result = await runBackup(env);
    await env.DB.batch([auditStmt(env.DB, user.id, 'backup.run', 'backup', result.key, { bytes: result.bytes })]);
    return ok(result);
  },
  { role: 'ADMIN' },
);
