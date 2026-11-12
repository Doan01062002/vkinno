/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./lib/env";
import { timingSafeCompare } from "./lib/crypto";
import { handleAdmin } from "./admin/router";
import { sendTelegramAlert, syncToGoogleSheetsRealtime } from "./lib/notify";

export type { Env };

const DEFAULT_GOOGLE_SHEET_ID = "1Q2JtTSh63BWD0znOVNLkpXfR1aPqswc9y7u8l-Xaxvo";
const DEFAULT_APPSHEET_URL =
  "https://www.appsheet.com/start/ced98270-b154-4be5-ada2-33887d06ea1f";
const VIETQR_BANK_BIN = "970436";
const VIETQR_ACCOUNT_NO = "0491000082331";
const VIETQR_ACCOUNT_NAME = "CONG TY TNHH CONG NGHE VINH KHANG";
const FREESHIP_THRESHOLD_VND = 199000;
const FLAT_SHIPPING_FEE_VND = 25000;
const PROJECT_SLUG = "chu-dong-vkinno";
const MAX_PUBLIC_BODY_BYTES = 16384;

interface ProductRow {
  sku: string;
  product_id: number;
  name: string;
  slug: string;
  price_vnd: number;
  listed_price_vnd: number;
  stock_qty: number;
  min_stock: number;
  is_combo: number;
  shelf_zone: string;
  shelf_label: string;
  batch_code: string;
  expiry_date: string;
  image_url: string;
  updated_at: string;
}

interface BomRow {
  combo_sku: string;
  component_sku: string;
  qty_per_combo: number;
}

// Per-isolate sliding window rate-limiter (protects login, checkout, leads, tracking)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
  }
  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count += 1;
  return true;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store, max-age=0",
      ...extraHeaders,
    },
  });
}

function normalizeVnPhone(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+84")) digits = "0" + digits.slice(3);
  else if (digits.startsWith("84") && digits.length === 11) digits = "0" + digits.slice(2);
  return digits.replace(/\D/g, "");
}

function isValidVnPhone(phone: string): boolean {
  return /^0[235789]\d{8,9}$/.test(phone);
}

function generateOrderCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = new Uint8Array(6);
  crypto.getRandomValues(rand);
  let suffix = "";
  for (let i = 0; i < rand.length; i++) {
    suffix += alphabet[rand[i] % alphabet.length];
  }
  return `VK${suffix}`;
}

function buildVietQrUrl(amountVnd: number, orderCode: string): string {
  const params = new URLSearchParams({
    amount: String(Math.max(0, Math.round(amountVnd))),
    addInfo: orderCode,
    accountName: VIETQR_ACCOUNT_NAME,
  });
  return `https://img.vietqr.io/image/${VIETQR_BANK_BIN}-${VIETQR_ACCOUNT_NO}-compact2.png?${params.toString()}`;
}

async function readJsonSafe<T = Record<string, unknown>>(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: T; raw: string } | { ok: false; status: number; error: string }> {
  const lenHeader = Number(request.headers.get("Content-Length") || "0");
  if (lenHeader > maxBytes) {
    return { ok: false, status: 413, error: "Dữ liệu gửi lên vượt quá giới hạn cho phép." };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { ok: false, status: 413, error: "Dữ liệu gửi lên vượt quá giới hạn cho phép." };
  }
  try {
    return { ok: true, data: JSON.parse(raw) as T, raw };
  } catch {
    return { ok: false, status: 400, error: "Định dạng JSON không hợp lệ." };
  }
}

async function loadCatalogWithBom(db: D1Database) {
  const [{ results: prodRows }, { results: bomRows }] = await Promise.all([
    db
      .prepare(
        `SELECT sku, product_id, name, slug, price_vnd, listed_price_vnd, stock_qty, min_stock,
                is_combo, shelf_zone, shelf_label, batch_code, expiry_date, image_url, updated_at
         FROM products ORDER BY is_combo DESC, product_id ASC`
      )
      .all<ProductRow>(),
    db.prepare(`SELECT combo_sku, component_sku, qty_per_combo FROM bom_items`).all<BomRow>(),
  ]);

  const bySku = new Map<string, ProductRow>();
  const byId = new Map<number, ProductRow>();
  const bySlug = new Map<string, ProductRow>();
  for (const p of prodRows) {
    bySku.set(p.sku, p);
    byId.set(p.product_id, p);
    bySlug.set(p.slug, p);
  }

  const bomByCombo = new Map<string, BomRow[]>();
  for (const b of bomRows) {
    const arr = bomByCombo.get(b.combo_sku) || [];
    arr.push(b);
    bomByCombo.set(b.combo_sku, arr);
  }

  const enriched = prodRows.map((p) => {
    if (p.is_combo === 1) {
      const comps = bomByCombo.get(p.sku) || [];
      const compDetails = comps.map((c) => {
        const cp = bySku.get(c.component_sku);
        return {
          sku: c.component_sku,
          component_sku: c.component_sku,
          name: cp?.name || c.component_sku,
          qty_per_combo: c.qty_per_combo,
          stock_qty: cp?.stock_qty ?? 0,
          shelf_zone: cp?.shelf_zone || "BLUE_BUFFER",
          shelf_label: cp?.shelf_label || "",
        };
      });
      const avail =
        compDetails.length > 0
          ? Math.min(...compDetails.map((c) => Math.floor(c.stock_qty / c.qty_per_combo)))
          : 0;
      return {
        ...p,
        available_stock: Math.max(0, avail),
        bom_components: compDetails,
      };
    }
    return {
      ...p,
      available_stock: p.stock_qty,
      bom_components: [] as Array<{
        sku: string;
        component_sku: string;
        name: string;
        qty_per_combo: number;
        stock_qty: number;
        shelf_zone: string;
        shelf_label: string;
      }>,
    };
  });

  return { prodRows, enriched, bySku, byId, bySlug, bomByCombo };
}

function expandPhysicalRequirements(
  items: Array<{ sku: string; quantity: number }>,
  bomByCombo: Map<string, BomRow[]>
): Map<string, { qty: number; viaCombo: boolean }> {
  const req = new Map<string, { qty: number; viaCombo: boolean }>();
  for (const item of items) {
    const comps = bomByCombo.get(item.sku);
    if (comps && comps.length > 0) {
      for (const c of comps) {
        const cur = req.get(c.component_sku) || { qty: 0, viaCombo: false };
        cur.qty += item.quantity * c.qty_per_combo;
        cur.viaCombo = true;
        req.set(c.component_sku, cur);
      }
    } else {
      const cur = req.get(item.sku) || { qty: 0, viaCombo: false };
      cur.qty += item.quantity;
      req.set(item.sku, cur);
    }
  }
  return req;
}

function buildPickingGuideText(
  items: Array<{ sku: string; quantity: number }>,
  bySku: Map<string, ProductRow>,
  bomByCombo: Map<string, BomRow[]>
): string {
  const physMap = expandPhysicalRequirements(items, bomByCombo);
  const parts: string[] = [];
  for (const [physSku, info] of physMap.entries()) {
    const p = bySku.get(physSku);
    const badge =
      p?.shelf_zone === "RED_ACID"
        ? "🔴 [Kệ 1 Đỏ]"
        : p?.shelf_zone === "GREEN_ALKALINE"
        ? "🟢 [Kệ 3 Xanh Lá]"
        : "🔵 [Kệ 2 Xanh Dương]";
    const shortName = p?.name
      ? p.name.length > 42
        ? p.name.slice(0, 42) + "..."
        : p.name
      : physSku;
    parts.push(`${badge} ${info.qty}x ${shortName}${info.viaCombo ? " (Tách BOM Combo)" : ""}`);
  }
  return parts.join(" + ");
}

function mapFuzzySku(rawText: string, bySku: Map<string, ProductRow>): ProductRow | undefined {
  const trimmed = rawText.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (bySku.has(upper)) return bySku.get(upper);

  const norm = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (norm.includes("combo") || (norm.includes("bossman") && norm.includes("dau mo"))) {
    return bySku.get("VK-COMBO-BOSSMAN-VKINNO-500ML");
  }
  if (norm.includes("solar")) return bySku.get("VK-SOLAR-SHIELD-5L");
  if (norm.includes("visionx") || norm.includes("o kinh")) return bySku.get("VK-VISIONX-CLEAN-500ML");
  if (norm.includes("bossman") || norm.includes("canxi")) return bySku.get("VK-BOSSMAN-DESCALER-500ML");
  if (norm.includes("dau mo") || norm.includes("degreaser") || norm.includes("bep")) {
    return bySku.get("VK-DEGREASER-500ML");
  }
  if (norm.includes("chai xit rong") || norm.includes("binh xit") || norm.includes("pet")) {
    return bySku.get("VK-BOTTLE-SPRAY-500ML");
  }
  if (norm.includes("o to") && norm.includes("5l")) return bySku.get("VK-CLEARWAY-AUTO-5L");
  if (norm.includes("glasspro") && norm.includes("5l")) return bySku.get("VK-CLEARWAY-GLASSPRO-5L");
  if (norm.includes("glasspro") || norm.includes("lau kinh")) {
    return bySku.get("VK-CLEARWAY-GLASSPRO-500ML");
  }
  return undefined;
}

function csvEscape(val: unknown): string {
  let s = String(val ?? "");
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s; // Prevent CSV Formula Injection in Excel/Sheets
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (!path.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }

    if (path === "/api/admin" || path.startsWith("/api/admin/")) {
      return handleAdmin(request, env, ctx);
    }

    const method = request.method.toUpperCase();
    const clientIp = getClientIp(request);

    try {
      // ======================================================================
      // 1. PUBLIC CATALOG: GET /api/products (and /api/products.json)
      // ======================================================================
      if ((path === "/api/products" || path === "/api/products.json") && method === "GET") {
        const { enriched } = await loadCatalogWithBom(env.DB);
        return jsonResponse({
          ok: true,
          freeship_threshold_vnd: FREESHIP_THRESHOLD_VND,
          flat_shipping_fee_vnd: FLAT_SHIPPING_FEE_VND,
          products: enriched,
        });
      }

      // ======================================================================
      // 2. PUBLIC CREATE ORDER: POST /api/orders
      // ======================================================================
      if (path === "/api/orders" && method === "POST") {
        if (!checkRateLimit(`orders:${clientIp}`, 20, 60_000)) {
          return jsonResponse(
            { ok: false, error: "Thao tác quá nhanh, vui lòng thử lại sau 1 phút." },
            429
          );
        }
        const parsed = await readJsonSafe<Record<string, unknown>>(request, MAX_PUBLIC_BODY_BYTES);
        if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);
        const body = parsed.data;

        // Honeypot check
        if (typeof body.website_url_trap === "string" && body.website_url_trap.trim() !== "") {
          return jsonResponse({ ok: false, error: "Yêu cầu không hợp lệ." }, 400);
        }

        // Hard Gate: du_an + BVDLCN 91/2025 consent
        if (body.du_an !== PROJECT_SLUG) {
          return jsonResponse({ ok: false, error: "Thiếu mã định danh dự án hợp lệ (du_an)." }, 400);
        }
        if (body.privacy_consent !== true) {
          return jsonResponse(
            {
              ok: false,
              error:
                "Vui lòng tích chọn đồng ý xử lý dữ liệu cá nhân theo Luật BVDLCN 91/2025/QH15 để đặt hàng.",
            },
            400
          );
        }

        const customerName = String(body.customer_name || "").trim();
        const customerPhone = normalizeVnPhone(body.customer_phone);
        const customerEmail = String(body.customer_email || "").trim().slice(0, 120);
        const assembledAddress = [
          String(body.shipping_address_detail || "").trim(),
          String(body.shipping_ward || "").trim(),
          String(body.shipping_province || "").trim(),
        ]
          .filter(Boolean)
          .join(", ");
        const shippingAddress = String(body.shipping_address || assembledAddress || "").trim();
        const notes = String(body.notes ?? body.customer_note ?? "").trim().slice(0, 500);
        const paymentMethod = body.payment_method === "VIETQR" ? "VIETQR" : "COD";
        const voucherCode = String(body.voucher_code || body.promo_code || "")
          .trim()
          .toUpperCase();

        if (customerName.length < 2 || customerName.length > 120) {
          return jsonResponse({ ok: false, error: "Vui lòng nhập họ và tên người nhận hợp lệ." }, 400);
        }
        if (!isValidVnPhone(customerPhone)) {
          return jsonResponse(
            { ok: false, error: "Số điện thoại Việt Nam không hợp lệ (10 số, bắt đầu bằng 0)." },
            400
          );
        }
        if (shippingAddress.length < 6 || shippingAddress.length > 350) {
          return jsonResponse({ ok: false, error: "Vui lòng nhập đầy đủ địa chỉ nhận hàng." }, 400);
        }

        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (rawItems.length === 0 || rawItems.length > 30) {
          return jsonResponse({ ok: false, error: "Giỏ hàng đang trống hoặc vượt quá giới hạn." }, 400);
        }

        const { bySku, byId, bySlug, bomByCombo } = await loadCatalogWithBom(env.DB);
        const mergedMap = new Map<string, { product: ProductRow; quantity: number }>();

        for (const rawItem of rawItems) {
          if (!rawItem || typeof rawItem !== "object") continue;
          const rec = rawItem as Record<string, unknown>;
          const qty = Number(rec.quantity ?? rec.qty ?? 0);
          if (!Number.isInteger(qty) || qty <= 0 || qty > 200) {
            return jsonResponse({ ok: false, error: "Số lượng sản phẩm không hợp lệ." }, 400);
          }
          const prod =
            (typeof rec.sku === "string" && rec.sku.trim() ? bySku.get(rec.sku.trim()) : undefined) ||
            (typeof rec.slug === "string" && rec.slug.trim() ? bySlug.get(rec.slug.trim()) : undefined) ||
            (typeof rec.id === "number" || typeof rec.product_id === "number"
              ? byId.get(Number(rec.id ?? rec.product_id))
              : undefined) ||
            (typeof rec.name === "string" ? mapFuzzySku(rec.name, bySku) : undefined);
          if (!prod) {
            return jsonResponse({ ok: false, error: "Có sản phẩm không tồn tại trong danh mục VKINNO." }, 400);
          }
          const existing = mergedMap.get(prod.sku);
          if (existing) existing.quantity += qty;
          else mergedMap.set(prod.sku, { product: prod, quantity: qty });
        }

        const normalizedItems = Array.from(mergedMap.values());
        if (normalizedItems.length === 0) {
          return jsonResponse({ ok: false, error: "Giỏ hàng không có sản phẩm hợp lệ." }, 400);
        }

        // Verify live physical stock across single items + Combo BOM components
        const physReq = expandPhysicalRequirements(
          normalizedItems.map((i) => ({ sku: i.product.sku, quantity: i.quantity })),
          bomByCombo
        );
        for (const [physSku, reqInfo] of physReq.entries()) {
          const physProd = bySku.get(physSku);
          if (!physProd || physProd.stock_qty < reqInfo.qty) {
            return jsonResponse(
              {
                ok: false,
                error: `Sản phẩm "${physProd?.name || physSku}" hiện chỉ còn ${physProd?.stock_qty ?? 0} đơn vị trong kho.`,
              },
              409
            );
          }
        }

        const subtotalVnd = normalizedItems.reduce(
          (sum, item) => sum + item.product.price_vnd * item.quantity,
          0
        );

        // Freeship rule: computed strictly on subtotal BEFORE discount (>= 199.000đ -> 0đ, else 25.000đ)
        const shippingFeeVnd = subtotalVnd >= FREESHIP_THRESHOLD_VND ? 0 : FLAT_SHIPPING_FEE_VND;

        let discountVnd = 0;
        let appliedVoucher = "";
        if (voucherCode === "KHACHCU10" || voucherCode === "VKINNO10") {
          discountVnd = Math.round(subtotalVnd * 0.1);
          appliedVoucher = voucherCode;
        } else if (voucherCode !== "") {
          return jsonResponse(
            { ok: false, error: `Mã ưu đãi "${voucherCode}" không tồn tại hoặc đã hết hạn.` },
            400
          );
        }

        const totalAmount = Math.max(0, subtotalVnd - discountVnd + shippingFeeVnd);

        // Generate collision-free VKxxxxxx code (0 PII in transfer memo)
        let orderCode = generateOrderCode();
        for (let attempt = 0; attempt < 5; attempt++) {
          const dup = await env.DB.prepare(`SELECT id FROM orders WHERE order_code = ?`)
            .bind(orderCode)
            .first();
          if (!dup) break;
          orderCode = generateOrderCode();
        }

        const insertOrderRes = await env.DB.prepare(
          `INSERT INTO orders (
            order_code, channel, customer_name, customer_phone, customer_email,
            shipping_address, notes, subtotal_vnd, shipping_fee_vnd, discount_vnd,
            voucher_code, total_amount, payment_method, payment_status, order_status,
            stock_deducted, privacy_consent, du_an
          ) VALUES (?, 'WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', 'PENDING', 0, 1, ?)`
        )
          .bind(
            orderCode,
            customerName,
            customerPhone,
            customerEmail,
            shippingAddress,
            notes,
            subtotalVnd,
            shippingFeeVnd,
            discountVnd,
            appliedVoucher,
            totalAmount,
            paymentMethod,
            PROJECT_SLUG
          )
          .run();

        const orderId = Number(insertOrderRes.meta.last_row_id);
        const itemStmts = normalizedItems.map((item) =>
          env.DB.prepare(
            `INSERT INTO order_items (order_id, sku, product_name, unit_price, quantity, line_total)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            orderId,
            item.product.sku,
            item.product.name,
            item.product.price_vnd,
            item.quantity,
            item.product.price_vnd * item.quantity
          )
        );
        await env.DB.batch(itemStmts);

        const vietqrUrl = buildVietQrUrl(totalAmount, orderCode);
        const itemsSummary = normalizedItems
          .map((i) => `${i.quantity}x ${i.product.sku}`)
          .join(" | ");
        const pickingGuideText = buildPickingGuideText(
          normalizedItems.map((i) => ({ sku: i.product.sku, quantity: i.quantity })),
          bySku,
          bomByCombo
        );

        const sheetsSync = await syncToGoogleSheetsRealtime(env, {
          action: "order.create",
          order_code: orderCode,
          channel: "WEB",
          customer_name: customerName,
          customer_phone: customerPhone,
          shipping_address: shippingAddress,
          items_summary: itemsSummary,
          picking_guide_text: pickingGuideText,
          subtotal_vnd: subtotalVnd,
          discount_vnd: discountVnd,
          shipping_fee_vnd: shippingFeeVnd,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          payment_status: "UNPAID",
          notes,
          items: normalizedItems.map((i) => ({
            sku: i.product.sku,
            quantity: i.quantity,
            unit_price: i.product.price_vnd,
          })),
        });

        ctx.waitUntil(
          sendTelegramAlert(
            env,
            `🛒 ĐƠN WEB MỚI #${orderCode}\nKhách: ${customerName} (${customerPhone})\nTổng: ${totalAmount.toLocaleString("vi-VN")}đ (${paymentMethod})\nNhặt kệ: ${pickingGuideText}\nĐ/c: ${shippingAddress}`
          )
        );

        return jsonResponse(
          {
            ok: true,
            sheets_sync: sheetsSync,
            order: {
              order_code: orderCode,
              subtotal_vnd: subtotalVnd,
              discount_vnd: discountVnd,
              voucher_code: appliedVoucher,
              shipping_fee_vnd: shippingFeeVnd,
              total_amount: totalAmount,
              total_vnd: totalAmount,
              payment_method: paymentMethod,
              payment_status: "UNPAID",
              order_status: "PENDING",
              picking_guide_text: pickingGuideText,
              vietqr_url: vietqrUrl,
              vietqr: {
                bin: VIETQR_BANK_BIN,
                bank_name: "Vietcombank (VCB)",
                account_no: VIETQR_ACCOUNT_NO,
                account_name: VIETQR_ACCOUNT_NAME,
                memo: orderCode,
                qr_url: vietqrUrl,
              },
              bank: {
                bin: VIETQR_BANK_BIN,
                bank_name: "Vietcombank (VCB)",
                account_no: VIETQR_ACCOUNT_NO,
                account_name: VIETQR_ACCOUNT_NAME,
                transfer_content: orderCode,
                qr_url: vietqrUrl,
              },
            },
          },
          201
        );
      }

      // ======================================================================
      // 3. PUBLIC LIGHTWEIGHT PAYMENT STATUS POLL: GET /api/orders/status?code=VK...
      // ======================================================================
      if (path === "/api/orders/status" && method === "GET") {
        const code = (url.searchParams.get("code") || "").trim().toUpperCase();
        if (!/^VK[A-Z0-9]{4,12}$/.test(code)) {
          return jsonResponse({ ok: false, error: "Mã đơn hàng không hợp lệ." }, 400);
        }
        const row = await env.DB.prepare(
          `SELECT order_code, payment_method, payment_status, paid_amount, total_amount, order_status, paid_at
           FROM orders WHERE order_code = ?`
        )
          .bind(code)
          .first<Record<string, unknown>>();
        if (!row) return jsonResponse({ ok: false, error: "Không tìm thấy đơn hàng." }, 404);
        return jsonResponse({
          ok: true,
          order_code: row.order_code,
          payment_method: row.payment_method,
          payment_status: row.payment_status,
          paid_amount_vnd: Number(row.paid_amount || 0),
          total_vnd: Number(row.total_amount || 0),
          order_status: row.order_status,
          paid_at: row.paid_at,
          status: row,
          order: row,
        });
      }

      // ======================================================================
      // 4. PUBLIC ORDER TRACKING (REQUIRES CODE + PHONE): GET /api/orders/track
      // ======================================================================
      if (path === "/api/orders/track" && method === "GET") {
        if (!checkRateLimit(`track:${clientIp}`, 25, 60_000)) {
          return jsonResponse({ ok: false, error: "Thao tác tra cứu quá nhanh, vui lòng đợi 1 phút." }, 429);
        }
        const code = (url.searchParams.get("code") || "").trim().toUpperCase();
        const phone = normalizeVnPhone(url.searchParams.get("phone") || "");

        if (!code || !isValidVnPhone(phone)) {
          return jsonResponse(
            { ok: false, error: "Vui lòng nhập đúng Mã đơn hàng (VD: VK8H3K9P) và Số điện thoại đặt hàng." },
            400
          );
        }

        const order = await env.DB.prepare(
          `SELECT id, order_code, channel, customer_name, customer_phone, shipping_address,
                  shipping_carrier, shipping_tracking_code,
                  subtotal_vnd, shipping_fee_vnd, discount_vnd, voucher_code, total_amount,
                  payment_method, payment_status, paid_amount, order_status, created_at, updated_at
           FROM orders WHERE order_code = ? AND customer_phone = ?`
        )
          .bind(code, phone)
          .first<Record<string, unknown>>();

        if (!order) {
          return jsonResponse(
            {
              ok: false,
              error: "Không tìm thấy đơn hàng khớp với Mã đơn và Số điện thoại này.",
            },
            404
          );
        }

        const { results: items } = await env.DB.prepare(
          `SELECT sku, product_name, unit_price, quantity, line_total
           FROM order_items WHERE order_id = ?`
        )
          .bind(order.id)
          .all<Record<string, unknown>>();

        const qrUrl =
          order.payment_method === "VIETQR" && order.payment_status !== "PAID"
            ? buildVietQrUrl(
                Math.max(0, Number(order.total_amount) - Number(order.paid_amount || 0)),
                String(order.order_code)
              )
            : null;

        const maskedPhone =
          phone.length >= 7 ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : phone;

        return jsonResponse({
          ok: true,
          order: {
            order_code: order.order_code,
            channel: order.channel,
            customer_name: order.customer_name,
            customer_phone: order.customer_phone,
            customer_phone_masked: maskedPhone,
            shipping_address: order.shipping_address,
            shipping_address_detail: order.shipping_address,
            shipping_carrier: order.shipping_carrier || "",
            shipping_tracking_code: order.shipping_tracking_code || "",
            subtotal_vnd: order.subtotal_vnd,
            shipping_fee_vnd: order.shipping_fee_vnd,
            discount_vnd: order.discount_vnd,
            voucher_code: order.voucher_code,
            total_amount: order.total_amount,
            total_vnd: Number(order.total_amount),
            payment_method: order.payment_method,
            payment_status: order.payment_status,
            paid_amount: order.paid_amount,
            paid_amount_vnd: Number(order.paid_amount || 0),
            order_status: order.order_status,
            created_at: order.created_at,
            updated_at: order.updated_at,
            qr_url: qrUrl,
            vietqr_url: qrUrl,
            items: items.map((it) => ({
              ...it,
              unit_price_vnd: Number(it.unit_price),
              line_total_vnd: Number(it.line_total),
            })),
          },
        });
      }

      // ======================================================================
      // 5. PUBLIC LEADS (B2B Gara/Solar, Contact, KOC Bossman): POST /api/leads
      // ======================================================================
      if (path === "/api/leads" && method === "POST") {
        if (!checkRateLimit(`leads:${clientIp}`, 15, 60_000)) {
          return jsonResponse({ ok: false, error: "Gửi biểu mẫu quá nhanh, vui lòng thử lại sau 1 phút." }, 429);
        }
        const parsed = await readJsonSafe<Record<string, unknown>>(request, MAX_PUBLIC_BODY_BYTES);
        if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);
        const body = parsed.data;

        if (typeof body.website_url_trap === "string" && body.website_url_trap.trim() !== "") {
          return jsonResponse({ ok: false, error: "Yêu cầu không hợp lệ." }, 400);
        }
        if (body.du_an !== PROJECT_SLUG) {
          return jsonResponse({ ok: false, error: "Thiếu trường định danh dự án (du_an)." }, 400);
        }
        if (body.privacy_consent !== true) {
          return jsonResponse(
            {
              ok: false,
              error:
                "Vui lòng tích chọn đồng ý xử lý dữ liệu cá nhân theo Luật BVDLCN 91/2025/QH15 trước khi gửi.",
            },
            400
          );
        }

        const rawType = String(body.lead_type || "CONTACT").toUpperCase();
        const leadType = rawType === "B2B" || rawType === "KOC" ? rawType : "CONTACT";
        const contactName = String(body.contact_name || body.name || "").trim();
        const phone = normalizeVnPhone(body.phone);
        const companyName = String(body.company_name || "").trim().slice(0, 160);
        const email = String(body.email || "").trim().slice(0, 120);
        const city = String(body.city || "").trim().slice(0, 100);
        const interest = String(body.interest || "").trim().slice(0, 160);
        const volumeEstimate = String(
          body.volume_estimate || body.estimated_volume || body.follower_count || ""
        )
          .trim()
          .slice(0, 120);
        const socialLink = String(body.social_link || body.channel_url || "").trim().slice(0, 250);
        const message = String(body.message || "").trim().slice(0, 1000);
        const sourceUrl = String(body.source_url || "").trim().slice(0, 250);

        if (contactName.length < 2) {
          return jsonResponse({ ok: false, error: "Vui lòng nhập họ tên người liên hệ." }, 400);
        }
        if (!isValidVnPhone(phone)) {
          return jsonResponse({ ok: false, error: "Số điện thoại liên hệ không hợp lệ." }, 400);
        }

        const res = await env.DB.prepare(
          `INSERT INTO leads (
            lead_type, company_name, contact_name, phone, email, city,
            interest, volume_estimate, social_link, message, status,
            du_an, privacy_consent, source_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, 1, ?)`
        )
          .bind(
            leadType,
            companyName,
            contactName,
            phone,
            email,
            city,
            interest,
            volumeEstimate,
            socialLink,
            message,
            PROJECT_SLUG,
            sourceUrl
          )
          .run();

        const sheetsLeadSync = await syncToGoogleSheetsRealtime(env, {
          action: "lead.create",
          lead_type: leadType,
          company_name: companyName,
          contact_name: contactName,
          phone,
          email,
          city,
          interest,
          volume_estimate: volumeEstimate,
          social_link: socialLink,
          message,
          source_url: sourceUrl,
        });

        ctx.waitUntil(
          sendTelegramAlert(
            env,
            `📩 LEAD MỚI [${leadType}] #${res.meta.last_row_id}\nLiên hệ: ${contactName} - ${phone}\nĐơn vị: ${companyName || "Cá nhân"}\nNhu cầu: ${interest || message || socialLink}`
          )
        );

        return jsonResponse(
          {
            ok: true,
            lead_id: Number(res.meta.last_row_id),
            sheets_sync: sheetsLeadSync,
            message: "Đã ghi nhận thông tin thành công. VKINNO sẽ liên hệ trong giờ hành chính.",
          },
          201
        );
      }

      // ======================================================================
      // 6. SEPAY VIETQR WEBHOOK (6 SECURITY GATES): POST /api/webhook/sepay
      // ======================================================================
      if (path === "/api/webhook/sepay" && method === "POST") {
        if (!env.SEPAY_WEBHOOK_API_KEY) {
          return jsonResponse({ success: false, error: "Webhook secret not configured" }, 503);
        }

        // Gate 2: Constant-time Apikey authentication
        const authHeader = request.headers.get("Authorization") || "";
        const expectedHeader = `Apikey ${env.SEPAY_WEBHOOK_API_KEY}`;
        const validAuth = await timingSafeCompare(authHeader, expectedHeader);
        if (!validAuth) {
          return jsonResponse({ success: false, error: "Unauthorized" }, 401);
        }

        // Gate 1: Strict 16KB body limit
        const parsed = await readJsonSafe<Record<string, unknown>>(request, MAX_PUBLIC_BODY_BYTES);
        if (!parsed.ok) {
          return jsonResponse({ success: false, error: parsed.error }, parsed.status);
        }
        const payload = parsed.data;
        const txId = Number(payload.id);
        if (!Number.isInteger(txId) || txId <= 0) {
          return jsonResponse({ success: false, error: "Invalid transaction id" }, 400);
        }

        // Gate 4: Idempotency check BEFORE any state mutation
        const existingTx = await env.DB.prepare(
          `SELECT id, match_status, matched_order_code FROM sepay_webhook_logs WHERE sepay_tx_id = ?`
        )
          .bind(txId)
          .first();
        if (existingTx) {
          return jsonResponse({
            success: true,
            duplicate: true,
            match_status: existingTx.match_status,
            matched_order_code: existingTx.matched_order_code,
          });
        }

        const gateway = String(payload.gateway || "VCB");
        const accountNumber = String(payload.accountNumber || "").trim();
        const transferType = String(payload.transferType || "").trim();
        const transferAmount = Math.round(Number(payload.transferAmount || 0));
        const referenceCode = payload.referenceCode ? String(payload.referenceCode) : null;
        const content = String(payload.content || payload.description || "");

        // Gate 3: Direction ("in") & Exact VCB corporate account ("0491000082331")
        if (transferType !== "in" || accountNumber !== VIETQR_ACCOUNT_NO || transferAmount <= 0) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO sepay_webhook_logs (
              sepay_tx_id, gateway, account_number, transfer_type, transfer_amount,
              reference_code, content, matched_order_code, match_status, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'IGNORED', ?)`
          )
            .bind(
              txId,
              gateway,
              accountNumber,
              transferType,
              Math.max(0, transferAmount),
              referenceCode,
              content,
              parsed.raw
            )
            .run();
          return jsonResponse({ success: true, ignored: true });
        }

        // Gate 5: Extract order code VKxxxx without PII
        const codeCandidate = `${String(payload.code || "")} ${content}`;
        const codeMatch = codeCandidate.match(/\b(VK[A-Z0-9]{4,10})\b/i);
        const extractedCode = codeMatch ? codeMatch[1].toUpperCase() : null;

        let targetOrder: {
          id: number;
          order_code: string;
          total_amount: number;
          paid_amount: number;
          payment_status: string;
        } | null = null;

        if (extractedCode) {
          targetOrder = await env.DB.prepare(
            `SELECT id, order_code, total_amount, paid_amount, payment_status
             FROM orders WHERE order_code = ?`
          )
            .bind(extractedCode)
            .first();
        }

        // Gate 6: Atomic D1 batch (PAID vs PARTIAL vs UNMATCHED)
        if (!targetOrder) {
          await env.DB.prepare(
            `INSERT INTO sepay_webhook_logs (
              sepay_tx_id, gateway, account_number, transfer_type, transfer_amount,
              reference_code, content, matched_order_code, match_status, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'UNMATCHED', ?)`
          )
            .bind(
              txId,
              gateway,
              accountNumber,
              transferType,
              transferAmount,
              referenceCode,
              content,
              parsed.raw
            )
            .run();

          ctx.waitUntil(
            sendTelegramAlert(
              env,
              `⚠️ TIỀN VÀO CHƯA RÕ MÃ ĐƠN: +${transferAmount.toLocaleString("vi-VN")}đ\nNội dung: ${content}\nKiểm tra ngay tại /quan-tri Tab 4.`
            )
          );
          return jsonResponse({ success: true, match_status: "UNMATCHED" });
        }

        const newPaidAmount = Number(targetOrder.paid_amount || 0) + transferAmount;
        const nextStatus = newPaidAmount >= Number(targetOrder.total_amount) ? "PAID" : "PARTIAL";

        await env.DB.batch([
          env.DB.prepare(
            `UPDATE orders
             SET paid_amount = ?, payment_status = ?, sepay_tx_id = ?,
                 paid_at = CASE WHEN ? = 'PAID' THEN datetime('now') ELSE paid_at END,
                 updated_at = datetime('now')
             WHERE id = ?`
          ).bind(newPaidAmount, nextStatus, txId, nextStatus, targetOrder.id),
          env.DB.prepare(
            `INSERT INTO sepay_webhook_logs (
              sepay_tx_id, gateway, account_number, transfer_type, transfer_amount,
              reference_code, content, matched_order_code, match_status, raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            txId,
            gateway,
            accountNumber,
            transferType,
            transferAmount,
            referenceCode,
            content,
            targetOrder.order_code,
            nextStatus,
            parsed.raw
          ),
        ]);

        const sheetsSepaySync = await syncToGoogleSheetsRealtime(env, {
          action: "sepay.webhook",
          id: txId,
          gateway,
          accountNumber,
          transferType,
          transferAmount,
          referenceCode,
          content,
        });

        ctx.waitUntil(
          sendTelegramAlert(
            env,
            nextStatus === "PAID"
              ? `✅ ĐÃ NHẬN ĐỦ TIỀN ĐƠN #${targetOrder.order_code}: +${transferAmount.toLocaleString("vi-VN")}đ (Tổng nhận: ${newPaidAmount.toLocaleString("vi-VN")}đ) — Đóng gói ngay trên AppSheet!`
              : `⚠️ CHUYỂN THIẾU ĐƠN #${targetOrder.order_code}: Nhận ${newPaidAmount.toLocaleString("vi-VN")}đ / Cần ${Number(targetOrder.total_amount).toLocaleString("vi-VN")}đ`
          )
        );

        return jsonResponse({
          success: true,
          match_status: nextStatus,
          matched_order_code: targetOrder.order_code,
          paid_amount: newPaidAmount,
          sheets_sync: sheetsSepaySync,
        });
      }

      return jsonResponse({ ok: false, error: "Endpoint API không tồn tại." }, 404);
    } catch (err) {
      console.error("Worker API unhandled error:", err);
      return jsonResponse(
        {
          ok: false,
          error:
            "Hệ thống đang bận xử lý. Quý khách vui lòng thử lại hoặc liên hệ Zalo/Hotline 0938.791.389.",
        },
        500
      );
    }
  },
};
