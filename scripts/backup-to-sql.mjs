// Dùng: node scripts/backup-to-sql.mjs <backup.json> [out.sql]
// Đọc bản sao lưu (JSON đã gunzip: { created_at, tables: { <bảng>: [dòng...] } }) và sinh
// DELETE + INSERT cho từng bảng theo thứ tự an toàn khoá ngoại:
// xoá con trước cha, chèn cha trước con. Mặc định ghi ra stdout.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Thứ tự cha → con (bảng chưa liệt kê được chèn sau cùng, theo tên).
export const TABLE_ORDER = [
  'users',
  'customers',
  'suppliers',
  'products',
  'bom_items',
  'orders',
  'order_items',
  'quotes',
  'quote_items',
  'stock_docs',
  'stock_doc_lines',
  'payments',
  'inventory_logs',
  'channel_sku_map',
  'import_batches',
  'leads',
  'sepay_webhook_logs',
  'app_settings',
  'login_attempts',
  'audit_logs',
];

export const quoteIdent = (s) => `"${String(s).replaceAll('"', '""')}"`;

export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Giá trị số không hợp lệ: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
  return `'${String(v).replaceAll("'", "''")}'`;
}

export function orderTables(names) {
  const known = TABLE_ORDER.filter((t) => names.includes(t));
  const rest = names.filter((t) => !TABLE_ORDER.includes(t)).sort();
  return [...known, ...rest];
}

/** Trả chuỗi SQL: toàn bộ DELETE (con → cha) rồi toàn bộ INSERT (cha → con), có `PRAGMA defer_foreign_keys`. */
export function backupToSql(backup) {
  const tables = backup?.tables;
  if (!tables || typeof tables !== 'object') throw new Error('Tệp sao lưu không có khoá "tables"');
  const ordered = orderTables(Object.keys(tables).filter((t) => !t.startsWith('_cf_') && !t.startsWith('sqlite_') && t !== 'd1_migrations'));
  const out = [`-- Khôi phục từ bản sao lưu tạo lúc ${backup.created_at ?? '(không rõ)'}`, 'PRAGMA defer_foreign_keys = true;'];
  for (const t of [...ordered].reverse()) out.push(`DELETE FROM ${quoteIdent(t)};`);
  for (const t of ordered) {
    for (const row of tables[t]) {
      const cols = Object.keys(row);
      if (!cols.length) continue;
      out.push(
        `INSERT INTO ${quoteIdent(t)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(', ')});`,
      );
    }
  }
  return `${out.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('Dùng: node scripts/backup-to-sql.mjs <backup.json> [out.sql]');
    process.exit(1);
  }
  const sql = backupToSql(JSON.parse(readFileSync(input, 'utf8')));
  if (output) writeFileSync(output, sql);
  else process.stdout.write(sql);
}
