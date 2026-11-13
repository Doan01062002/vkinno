import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - script .mjs không có khai báo kiểu
import * as rec from '../scripts/reconcile-products.mjs';
// @ts-expect-error - script .mjs không có khai báo kiểu
import * as b2s from '../scripts/backup-to-sql.mjs';

const read = (f: string) => readFileSync(join(process.cwd(), 'migrations', f), 'utf8');

const INIT = `
INSERT OR IGNORE INTO products (sku, product_id, name, slug, price_vnd, listed_price_vnd, stock_qty, image_url) VALUES
  ('SKU-A', 1, 'Chai tẩy O''Brien 500ml', 'slug-a', 69000, 90000, 5, '/images/a.jpg'),
  ('SKU-B', 2, 'Nước lau kính; trong', 'slug-b-old', 45000, 59000, 7, '/images/b.jpg'),
  ('SKU-C', 3, 'Không có trên web', 'slug-c', 1000, 2000, 1, '/images/c.jpg');
`;
const LATER = `UPDATE products SET slug = 'slug-b', price_vnd = 46000 WHERE sku = 'SKU-B';
UPDATE products SET price_vnd = 1, listed_price_vnd = 2 WHERE sku = 'SKU-NONE';`;

const live = (over: object) => ({
  slug: 'x',
  title: 't',
  price: '90000.00',
  sale_price: '69000.00',
  image_url: 'https://down-vn.img.susercontent.com/file/abc',
  description: 'Mô tả<br>dòng 2 &amp; &quot;ok&quot;',
  ...over,
});

describe('parseSeedProducts', () => {
  const seeds = rec.parseSeedProducts(INIT, [LATER]);

  it('đọc đủ dòng, hiểu dấu nháy kép "\'\'" và dấu ; trong chuỗi', () => {
    expect(seeds.map((s: any) => s.sku)).toEqual(['SKU-A', 'SKU-B', 'SKU-C']);
    expect(seeds[0].name).toBe("Chai tẩy O'Brien 500ml");
    expect(seeds[1].name).toBe('Nước lau kính; trong');
    expect(seeds[0]).toMatchObject({ price_vnd: 69000, listed_price_vnd: 90000, product_id: 1 });
  });

  it('áp UPDATE ở migration sau, bỏ qua sku không tồn tại', () => {
    expect(seeds[1]).toMatchObject({ slug: 'slug-b', price_vnd: 46000, listed_price_vnd: 59000 });
    expect(seeds).toHaveLength(3);
  });

  it('đọc đúng migration thật: 9 sản phẩm, slug combo và giá combo từ 0002', () => {
    const real = rec.parseSeedProducts(read('0001_init.sql'), [read('0002_sync_orders_and_slugs.sql'), read('0003_admin.sql')]);
    expect(real).toHaveLength(9);
    const combo = real.find((p: any) => p.sku === 'VK-COMBO-BOSSMAN-VKINNO-500ML');
    expect(combo).toMatchObject({ price_vnd: 145000, listed_price_vnd: 154000 });
    expect(combo.slug).toContain('combobossmanvkinno-1782568108');
  });
});

describe('matchProducts', () => {
  const seeds = rec.parseSeedProducts(INIT, [LATER]);

  it('khớp theo slug, rồi theo tên chuẩn hoá; báo phần không khớp hai phía', () => {
    const r = rec.matchProducts(seeds, [
      live({ slug: 'slug-a', title: 'khác' }),
      live({ slug: 'lech-slug', title: 'NƯỚC LAU KÍNH  trong' }),
      live({ slug: 'chi-co-tren-web' }),
    ]);
    expect(r.matches.map((m: any) => [m.seed.sku, m.by])).toEqual([
      ['SKU-A', 'slug'],
      ['SKU-B', 'name'],
    ]);
    expect(r.unmatchedSeed.map((s: any) => s.sku)).toEqual(['SKU-C']);
    expect(r.unmatchedLive.map((l: any) => l.slug)).toEqual(['chi-co-tren-web']);
  });

  it('chênh lệch: giá bán = sale_price ?? price, niêm yết = price, ảnh, mô tả (HTML → text)', () => {
    const r = rec.matchProducts(seeds, [
      live({ slug: 'slug-a', price: '100000.00', sale_price: null, description: 'A<br>B &amp; C' }),
    ]);
    const d = r.matches[0].diffs;
    expect(d.price_vnd).toEqual({ seed: 69000, live: 100000 });
    expect(d.listed_price_vnd).toEqual({ seed: 90000, live: 100000 });
    expect(d.image_url.live).toContain('susercontent.com');
    expect(d.description.live).toBe('A\nB & C');
  });

  it('không chênh lệch thì diffs rỗng', () => {
    const r = rec.matchProducts(
      [{ sku: 'S', name: 'n', slug: 's', price_vnd: 10, listed_price_vnd: 20, image_url: 'u', description: '' }],
      [live({ slug: 's', price: '20', sale_price: '10', image_url: 'u', description: '' })],
    );
    expect(r.matches[0].diffs).toEqual({});
  });
});

describe('buildSql', () => {
  const seeds = rec.parseSeedProducts(INIT, [LATER]);
  const { matches } = rec.matchProducts(seeds, [
    live({ slug: 'slug-a', description: "Tẩy 'mạnh'\nO'Brien; xong" }),
    live({ slug: 'slug-b', price: '59000', sale_price: '46000', image_url: '/images/b.jpg', description: '' }),
  ]);

  it('chỉ UPDATE ... WHERE sku, thoát dấu nháy, không đụng sku, bỏ qua dòng không đổi, không đổi ảnh khi chưa upload', () => {
    const sql: string = rec.buildSql(matches);
    const stmts = sql
      .replace(/^--.*\n/, '')
      .split(/;\n/)
      .filter(Boolean)
      .map((x) => `${x};`);
    expect(stmts.every((l) => l.startsWith('UPDATE products SET '))).toBe(true);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain("WHERE sku = 'SKU-A';");
    expect(sql).not.toMatch(/SET[^;]*\bsku\s*=/);
    expect(sql).not.toContain('image_url');
    expect(sql).toContain("description = 'Tẩy ''mạnh''\nO''Brien; xong'");
    expect(sql).not.toMatch(/INSERT|DELETE|DROP/i);
  });

  it('đổi image_url sang /files/... khi đã upload ảnh', () => {
    const sql: string = rec.buildSql(matches, { 'SKU-B': '/files/products/sku-b.jpg' });
    expect(sql).toContain("image_url = '/files/products/sku-b.jpg'");
    expect(sql).toContain("WHERE sku = 'SKU-B';");
  });
});

describe('backup-to-sql', () => {
  const backup = {
    created_at: '2026-11-12T19:00:00.000Z',
    tables: {
      order_items: [{ id: 1, order_id: 1, sku: 'A', quantity: 2 }],
      products: [{ sku: 'A', name: "O'Brien \"x\"; DROP", cost_avg_vnd: 0, note: null, gallery_json: '[]' }],
      orders: [{ id: 1, order_code: 'VK1', note: 'a\nb' }],
      d1_migrations: [{ id: 1, name: '0001_init.sql' }],
      zzz_extra: [{ v: 1.5 }],
      empty_table: [],
    },
  };
  const sql: string = b2s.backupToSql(backup);
  const lines = sql.split('\n');
  const idx = (needle: string) => lines.findIndex((l) => l.includes(needle));

  it('thoát dấu nháy, NULL, số, xuống dòng', () => {
    expect(sql).toContain(`VALUES ('A', 'O''Brien "x"; DROP', 0, NULL, '[]');`);
    expect(sql).toContain(`'a\nb'`);
    expect(sql).toContain('VALUES (1.5);');
  });

  it('DELETE con → cha rồi INSERT cha → con; bảng lạ xếp sau cùng; bỏ d1_migrations', () => {
    expect(idx('DELETE FROM "order_items"')).toBeLessThan(idx('DELETE FROM "orders"'));
    expect(idx('DELETE FROM "orders"')).toBeLessThan(idx('DELETE FROM "products"'));
    const lastDelete = Math.max(...lines.map((l, i) => (l.startsWith('DELETE') ? i : -1)));
    expect(lastDelete).toBeLessThan(idx('INSERT INTO'));
    expect(idx('INSERT INTO "products"')).toBeLessThan(idx('INSERT INTO "orders"'));
    expect(idx('INSERT INTO "orders"')).toBeLessThan(idx('INSERT INTO "order_items"'));
    expect(idx('INSERT INTO "order_items"')).toBeLessThan(idx('INSERT INTO "zzz_extra"'));
    expect(sql).not.toContain('d1_migrations');
    expect(sql).toContain('PRAGMA defer_foreign_keys = true;');
    expect(sql).toContain('DELETE FROM "empty_table";');
  });

  it('từ chối tệp không có tables', () => {
    expect(() => b2s.backupToSql({})).toThrow();
  });
});
