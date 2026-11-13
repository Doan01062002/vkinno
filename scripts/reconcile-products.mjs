// Đối chiếu 9 sản phẩm seed (migrations) với dữ liệu đang chạy trên vkinno.vn.
//
// Dùng:
//   node scripts/reconcile-products.mjs                       (chỉ đọc: GET + in bảng + ghi scripts/out/reconcile.sql)
//   node scripts/reconcile-products.mjs --upload-images       (thêm: tải ảnh susercontent.com về scripts/out/images/,
//                                                              in lệnh `wrangler r2 object put`, SQL đổi image_url)
//   node scripts/reconcile-products.mjs --upload-images --run [--bucket vkinno-files-staging]
//                                                             (chạy luôn các lệnh wrangler; cần `npx wrangler login`)
//
// Chỉ sinh UPDATE ... WHERE sku = ... (không bao giờ đổi sku). Không tự áp SQL: xem rồi mới chạy
// `npx wrangler d1 execute vkinno-db --remote --file scripts/out/reconcile.sql`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = 'https://vkinno.vn/api/products?limit=200';
const USER_AGENT = 'vkinno-reconcile/1.0';

// ---------------------------------------------------------------------------
// Phân tích SQL seed
// ---------------------------------------------------------------------------

/** Tách các bộ giá trị `( ... ), ( ... )` trong một khối VALUES; hiểu chuỗi '...' với '' là dấu nháy. */
function parseTuples(text) {
  const tuples = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '(') {
      i++;
      continue;
    }
    i++;
    const values = [];
    let cur = '';
    let isStr = false;
    let started = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "'") {
        started = true;
        isStr = true;
        cur = '';
        i++;
        for (; i < text.length; i++) {
          if (text[i] === "'") {
            if (text[i + 1] === "'") {
              cur += "'";
              i++;
            } else break;
          } else cur += text[i];
        }
      } else if (c === ',' || c === ')') {
        if (started || cur.trim() !== '') {
          const t = cur.trim();
          values.push(isStr ? cur : t.toUpperCase() === 'NULL' ? null : Number(t));
        }
        cur = '';
        isStr = false;
        started = false;
        if (c === ')') break;
      } else if (c === '-' && text[i + 1] === '-') {
        while (i < text.length && text[i] !== '\n') i++;
      } else {
        cur += c;
        if (!/\s/.test(c)) started = true;
      }
    }
    i++;
    tuples.push(values);
  }
  return tuples;
}

/** Cắt khối `INSERT ... INTO products (cols) VALUES ...;` (câu lệnh kết thúc ở dấu `;` ngoài chuỗi). */
function extractInsert(sql, table) {
  const m = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\s*\\(([^)]*)\\)\\s*VALUES`, 'i').exec(sql);
  if (!m) return null;
  const columns = m[1].split(',').map((s) => s.trim());
  let i = m.index + m[0].length;
  const start = i;
  let inStr = false;
  for (; i < sql.length; i++) {
    if (sql[i] === "'") inStr = !inStr;
    else if (sql[i] === ';' && !inStr) break;
  }
  return { columns, body: sql.slice(start, i) };
}

/** Giá trị của `col = <literal>` trong mệnh đề SET (chuỗi hoặc số). */
function parseSetClause(set) {
  const out = {};
  const re = /(\w+)\s*=\s*('(?:[^']|'')*'|-?\d+(?:\.\d+)?|NULL)/gi;
  let m;
  while ((m = re.exec(set))) {
    const raw = m[2];
    out[m[1]] =
      raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : raw.toUpperCase() === 'NULL' ? null : Number(raw);
  }
  return out;
}

/**
 * Đọc sản phẩm seed từ SQL của 0001 rồi áp các `UPDATE products SET ... WHERE sku = '...'` ở các migration sau.
 * @param {string} initSql nội dung 0001_init.sql
 * @param {string[]} laterSql nội dung các migration sau (theo thứ tự)
 */
export function parseSeedProducts(initSql, laterSql = []) {
  const ins = extractInsert(initSql, 'products');
  if (!ins) throw new Error('Không tìm thấy INSERT INTO products trong migration 0001');
  const products = parseTuples(ins.body).map((vals) => Object.fromEntries(ins.columns.map((c, i) => [c, vals[i]])));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  for (const sql of laterSql) {
    const re = /UPDATE\s+products\s+SET\s+((?:[^;']|'(?:[^']|'')*')*?)\s+WHERE\s+sku\s*=\s*'((?:[^']|'')*)'\s*;/gi;
    let m;
    while ((m = re.exec(sql))) {
      const row = bySku.get(m[2].replaceAll("''", "'"));
      if (row) Object.assign(row, parseSetClause(m[1]));
    }
  }
  return products;
}

// ---------------------------------------------------------------------------
// Chuẩn hoá & khớp
// ---------------------------------------------------------------------------

export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML mô tả của website → văn bản thuần (xuống dòng giữ lại). */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const toInt = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v)));

/** Một sản phẩm của API website → các trường dùng để so sánh. `price` là giá niêm yết, `sale_price` là giá bán. */
export function normalizeLive(p) {
  const listed = toInt(p.price);
  const sale = toInt(p.sale_price);
  return {
    slug: p.slug,
    name: p.title ?? '',
    price_vnd: sale ?? listed,
    listed_price_vnd: listed,
    image_url: p.image_url ?? '',
    description: htmlToText(p.description),
  };
}

const FIELDS = ['price_vnd', 'listed_price_vnd', 'image_url', 'description'];

/**
 * Khớp theo slug, sau đó theo tên chuẩn hoá. Trả { matches:[{seed, live, by, diffs}], unmatchedSeed, unmatchedLive }.
 * diffs: { field: {seed, live} } cho các trường khác nhau.
 */
export function matchProducts(seeds, lives) {
  const remaining = lives.map(normalizeLive);
  const take = (pred) => {
    const idx = remaining.findIndex(pred);
    return idx === -1 ? null : remaining.splice(idx, 1)[0];
  };
  const matches = [];
  const unmatchedSeed = [];
  const pending = [];
  for (const seed of seeds) {
    const live = take((l) => l.slug === seed.slug);
    if (live) matches.push({ seed, live, by: 'slug' });
    else pending.push(seed);
  }
  for (const seed of pending) {
    const n = normalizeName(seed.name);
    const live = take((l) => normalizeName(l.name) === n);
    if (live) matches.push({ seed, live, by: 'name' });
    else unmatchedSeed.push(seed);
  }
  for (const m of matches) {
    m.diffs = {};
    for (const f of FIELDS) {
      const s = m.seed[f] ?? '';
      const l = m.live[f] ?? '';
      if (s !== l) m.diffs[f] = { seed: s, live: l };
    }
  }
  return { matches, unmatchedSeed, unmatchedLive: remaining };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const sqlString = (s) => `'${String(s).replaceAll("'", "''")}'`;
const sqlValue = (v) => (typeof v === 'number' ? String(v) : sqlString(v));

/**
 * Chỉ UPDATE ... WHERE sku = ..., không đổi sku.
 * imageUrls: { [sku]: '/files/products/...' } — chỉ khi đã tải ảnh lên R2; không có thì không đụng image_url.
 */
export function buildSql(matches, imageUrls = {}) {
  const lines = ['-- Sinh bởi scripts/reconcile-products.mjs - chỉ UPDATE, không đổi sku. Xem kỹ trước khi áp.'];
  for (const m of matches) {
    const sets = [];
    for (const f of ['price_vnd', 'listed_price_vnd', 'description']) {
      if (m.diffs[f]) sets.push(`${f} = ${sqlValue(m.diffs[f].live)}`);
    }
    if (imageUrls[m.seed.sku]) sets.push(`image_url = ${sqlString(imageUrls[m.seed.sku])}`);
    if (!sets.length) continue;
    sets.push("updated_at = datetime('now')");
    lines.push(`UPDATE products SET ${sets.join(', ')} WHERE sku = ${sqlString(m.seed.sku)};`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// In bảng
// ---------------------------------------------------------------------------

const vnd = (n) => (typeof n === 'number' ? new Intl.NumberFormat('vi-VN').format(n) : String(n));
const clip = (s, n = 38) => {
  const t = String(s).replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function formatReport({ matches, unmatchedSeed, unmatchedLive }) {
  const out = [];
  out.push(
    `Khớp ${matches.length} sản phẩm; seed không khớp: ${unmatchedSeed.length}; website không khớp: ${unmatchedLive.length}`,
  );
  out.push('');
  for (const m of matches) {
    const keys = Object.keys(m.diffs);
    out.push(`${m.seed.sku} (khớp theo ${m.by})${keys.length ? '' : ' - không chênh lệch'}`);
    for (const f of keys) {
      const { seed, live } = m.diffs[f];
      const isNum = typeof seed === 'number' || typeof live === 'number';
      out.push(`  ${f.padEnd(17)} seed: ${isNum ? vnd(seed) : clip(seed) || '(trống)'}`);
      out.push(`  ${''.padEnd(17)} web : ${isNum ? vnd(live) : clip(live) || '(trống)'}`);
    }
  }
  if (unmatchedSeed.length) out.push('', 'Seed không có trên website:', ...unmatchedSeed.map((p) => `  ${p.sku}`));
  if (unmatchedLive.length) out.push('', 'Website không có trong seed:', ...unmatchedLive.map((p) => `  ${p.slug}`));
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Ảnh
// ---------------------------------------------------------------------------

const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const isSusercontent = (url) => {
  try {
    const h = new URL(url).hostname;
    return h === 'susercontent.com' || h.endsWith('.susercontent.com');
  } catch {
    return false;
  }
};

async function downloadImages(matches, outDir) {
  mkdirSync(outDir, { recursive: true });
  const uploads = [];
  for (const m of matches) {
    const url = m.live.image_url;
    if (!isSusercontent(url)) continue;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      console.error(`Không tải được ảnh ${m.seed.sku}: HTTP ${res.status}`);
      continue;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) {
      console.error(`Bỏ qua ảnh ${m.seed.sku}: kiểu ${type || 'không rõ'} (chỉ nhận jpeg/png/webp)`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) {
      console.error(`Bỏ qua ảnh ${m.seed.sku}: lớn hơn 5 MB`);
      continue;
    }
    const file = `${m.seed.sku.toLowerCase()}.${ext}`;
    writeFileSync(join(outDir, file), buf);
    uploads.push({ sku: m.seed.sku, file, type, key: `products/${file}` });
  }
  return uploads;
}

const quote = (s) => (/^[\w./:=-]+$/.test(s) ? s : `"${s}"`);

export function r2PutArgs(bucket, up, dir) {
  return [
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucket}/${up.key}`,
    '--file',
    `${dir}/${up.file}`,
    '--content-type',
    up.type,
    '--remote',
  ];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const upload = args.includes('--upload-images');
  const run = args.includes('--run');
  const bi = args.indexOf('--bucket');
  const bucket = bi >= 0 ? args[bi + 1] : 'vkinno-files';
  if (!bucket) throw new Error('--bucket cần tên bucket');

  const migDir = join(ROOT, 'migrations');
  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const initName = files.find((f) => f.startsWith('0001'));
  const initSql = readFileSync(join(migDir, initName), 'utf8');
  const later = files.filter((f) => f !== initName).map((f) => readFileSync(join(migDir, f), 'utf8'));
  const seeds = parseSeedProducts(initSql, later);

  const res = await fetch(API_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${API_URL} -> HTTP ${res.status}`);
  const json = await res.json();
  const lives = json?.data?.products;
  if (!Array.isArray(lives)) throw new Error('Phản hồi không có data.products');

  const result = matchProducts(seeds, lives);
  console.log(formatReport(result));

  const outDir = join(ROOT, 'scripts', 'out');
  mkdirSync(outDir, { recursive: true });
  let imageUrls = {};
  if (upload) {
    const ups = await downloadImages(result.matches, join(outDir, 'images'));
    imageUrls = Object.fromEntries(ups.map((u) => [u.sku, `/files/${u.key}`]));
    console.log(`\nĐã tải ${ups.length} ảnh vào scripts/out/images. Lệnh upload lên R2 (bucket ${bucket}):`);
    for (const u of ups) {
      const a = r2PutArgs(bucket, u, 'scripts/out/images');
      console.log(`  npx ${a.map(quote).join(' ')}`);
      if (run) execFileSync('npx', a, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
    }
    if (!run) console.log('(Chưa chạy. Thêm --run để chạy các lệnh trên, hoặc tự chạy sau khi `npx wrangler login`.)');
  }
  const sqlPath = join(outDir, 'reconcile.sql');
  writeFileSync(sqlPath, buildSql(result.matches, imageUrls));
  console.log(`\nĐã ghi ${sqlPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
