/// <reference types="@cloudflare/workers-types" />
// Bộ chuyển D1 -> node:sqlite dùng cho test và dev cục bộ (không cần workerd).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Param = string | number | bigint | null | Uint8Array;

function norm(v: unknown): Param {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as Param;
}

function normRow<T>(row: T): T {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = typeof v === 'bigint' ? Number(v) : v;
    }
    return out as T;
  }
  return row;
}

class TestStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.sqlite, this.sql, values.map(norm));
  }

  private meta(changes: number, lastRowId: number, start: number) {
    return { duration: performance.now() - start, changes, last_row_id: lastRowId };
  }

  runSync() {
    const start = performance.now();
    const info = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      results: [],
      success: true as const,
      meta: this.meta(Number(info.changes), Number(info.lastInsertRowid), start),
    };
  }

  allSync<T = Record<string, unknown>>() {
    const start = performance.now();
    const rows = this.sqlite
      .prepare(this.sql)
      .all(...this.params)
      .map(normRow) as T[];
    return { results: rows, success: true as const, meta: this.meta(0, 0, start) };
  }

  async run() {
    return this.runSync();
  }

  async all<T = Record<string, unknown>>() {
    return this.allSync<T>();
  }

  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    const out = normRow(row);
    return (col === undefined ? out : (out[col] ?? null)) as T | null;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.sqlite.prepare(this.sql);
    stmt.setReturnArrays(true);
    return stmt
      .all(...this.params)
      .map((r) => (r as unknown as unknown[]).map((v) => (typeof v === 'bigint' ? Number(v) : v))) as T[];
  }
}

class TestD1 {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new TestStatement(this.sqlite, sql);
  }

  async exec(sql: string) {
    const start = performance.now();
    // D1 luôn bật khoá ngoại và bỏ qua PRAGMA foreign_keys.
    this.sqlite.exec(sql.replace(/^[ \t]*PRAGMA\s+foreign_keys\s*=\s*\w+\s*;/gim, ''));
    return { count: 1, duration: performance.now() - start };
  }

  /**
   * Cả batch là một giao dịch: lỗi thì ROLLBACK và ném lại. Chạy đồng bộ hoàn toàn
   * (không await giữa BEGIN và COMMIT) nên các batch chạy chồng nhau không xen kẽ.
   */
  async batch(stmts: TestStatement[]) {
    const out = [];
    this.sqlite.exec('BEGIN');
    try {
      for (const s of stmts) {
        const head = s.sql.trim().toUpperCase();
        out.push(head.startsWith('SELECT') || head.startsWith('WITH') ? s.allSync() : s.runSync());
      }
      this.sqlite.exec('COMMIT');
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
    return out;
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump không được hỗ trợ trong bộ chuyển test');
  }

  withSession() {
    return this;
  }
}

/** Mở D1 giả trên SQLite. `path` mặc định là bộ nhớ. */
export function createTestD1(path = ':memory:'): D1Database {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  return new TestD1(sqlite) as unknown as D1Database;
}

/**
 * Chạy migrations/*.sql theo thứ tự tên file, mỗi file trong một giao dịch.
 * `filter` chọn file theo tên (dùng để dừng ở một phiên bản).
 */
export async function applyMigrations(
  db: D1Database,
  opts: { dir?: string; filter?: (name: string) => boolean } = {},
): Promise<void> {
  const dir = opts.dir ?? join(process.cwd(), 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && (opts.filter?.(f) ?? true))
    .sort();
  for (const f of files) {
    await db.exec('BEGIN');
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'));
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  }
}
