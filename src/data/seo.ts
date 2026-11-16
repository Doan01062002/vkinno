// Tiêu đề SEO + meta description (spec Marketing docs/nang-cap-giao-dien/02-seo-tieu-de-mo-ta.md).
// Giá KHÔNG gõ cứng: mẫu chứa biến {price}, {bo3}, {combo}, {combo_saving}, {min_price}, {freeship}, {count}
// được thay bằng giá từ products.ts / siteConfig.ts lúc build. test/seo.test.ts kiểm độ dài sau khi ghép.
import type { Product } from "../types";
import { products } from "./products";
import { SITE_CONFIG } from "./siteConfig";

/** Định dạng giá kiểu "45.000đ" (không phụ thuộc ICU của máy build). */
export function formatVndShort(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

/** Biến dùng chung cho mọi mẫu (trừ {price} là giá của chính sản phẩm). */
export interface SeoVars {
  price?: number;
  bo3: number;
  combo: number;
  combo_saving: number;
  min_price: number;
  freeship: number;
  count: number;
}

const BO3_SKUS = ["VK-BOSSMAN-DESCALER-500ML", "VK-DEGREASER-500ML", "VK-CLEARWAY-GLASSPRO-500ML"];
const COMBO_SKU = "VK-COMBO-BOSSMAN-VKINNO-500ML";

function priceOf(list: Product[], sku: string): number {
  const p = list.find((x) => x.sku === sku);
  if (!p) throw new Error(`seo.ts: không thấy SKU ${sku} trong products.ts`);
  return p.price_vnd;
}

/** Tính biến giá từ danh sách sản phẩm (mặc định là products.ts). */
export function buildSeoVars(list: Product[] = products): SeoVars {
  const combo = list.find((x) => x.sku === COMBO_SKU);
  const comboParts = combo?.bom_skus ?? [];
  const comboPrice = combo?.price_vnd ?? 0;
  return {
    bo3: BO3_SKUS.reduce((sum, sku) => sum + priceOf(list, sku), 0),
    combo: comboPrice,
    combo_saving: comboParts.reduce((sum, sku) => sum + priceOf(list, sku), 0) - comboPrice,
    min_price: Math.min(...list.map((x) => x.price_vnd)),
    freeship: SITE_CONFIG.freeshipThresholdVnd,
    count: list.length,
  };
}

/** Thay {biến} trong mẫu; {count} giữ số trơn, còn lại định dạng giá. Thiếu biến thì báo lỗi lúc build. */
export function fillSeo(template: string, vars: SeoVars): string {
  return template.replace(/\{([a-z0-9_]+)\}/g, (_m, key: string) => {
    const v = (vars as unknown as Record<string, number | undefined>)[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`seo.ts: thiếu biến {${key}} trong mẫu "${template}"`);
    }
    return key === "count" ? String(v) : formatVndShort(v);
  });
}

export interface SeoText {
  title: string;
  description: string;
}

/** Tiêu đề/mô tả cho trang sản phẩm; sản phẩm chưa có mẫu SEO thì rơi về tên sản phẩm (như cũ). */
export function productSeo(p: Product, vars: SeoVars = buildSeoVars()): SeoText {
  const v = { ...vars, price: p.price_vnd };
  return {
    title: p.seo_title ? fillSeo(p.seo_title, v) : `${p.name} - VKINNO`,
    description: p.meta_description ? fillSeo(p.meta_description, v) : p.name,
  };
}

/** Mẫu cho 7 trang chính (khoá là đường dẫn có "/" cuối như trong spec). */
export const PAGE_SEO_TEMPLATES = {
  "/": {
    title: "Chất tẩy rửa sinh học nền nước Deion chính hãng | VKINNO",
    description:
      "Tẩy cặn canxi Bossman, tẩy dầu mỡ bếp, nước lau kính, nước rửa kính ô tô và vệ sinh pin mặt trời. Giá đã gồm VAT, freeship từ {freeship}, COD, đổi trả 7 ngày.",
  },
  "/san-pham/": {
    title: "Bảng giá chất tẩy rửa VKINNO: {count} sản phẩm, đã gồm VAT 8%",
    description:
      "{count} sản phẩm từ {min_price}: tẩy cặn canxi, tẩy dầu mỡ, lau kính, rửa kính ô tô, vệ sinh pin mặt trời. Combo Đôi Nhà Sạch {combo}, Bộ 3 Toàn Gia {bo3} freeship.",
  },
  "/gioi-thieu/": {
    title: "Giới thiệu VKINNO – Công ty TNHH Công nghệ Vĩnh Khang",
    description:
      "VKINNO là thương hiệu của Công ty TNHH Công nghệ Vĩnh Khang (MST 0107301786, Hà Nội), sản xuất chất tẩy rửa nền nước Deion cho gia đình, ô tô và điện mặt trời.",
  },
  "/lien-he/": {
    title: "Liên hệ VKINNO: hotline 0938.791.389, Zalo, kho Hà Nội",
    description:
      "Gọi 0938.791.389 hoặc nhắn Zalo để được tư vấn chọn sản phẩm, báo giá sỉ gara, đại lý. Văn phòng tại Cầu Giấy, kho xuất hàng tại Di Trạch, Hoài Đức, Hà Nội.",
  },
  "/giai-phap-gara/": {
    title: "Giá sỉ cho gara ô tô, chiết khấu 20–40% | VKINNO",
    description:
      "Chiết khấu sỉ 20–40% trên giá lẻ cho gara ô tô, Car Care và nhà thầu O&M điện mặt trời: nước rửa kính ClearWay 5L, tẩy ố VisionX, Solar Shield 5L. Giá gồm VAT.",
  },
  "/bossman-creator/": {
    title: "Đăng ký KOC Bossman: nhận mẫu dùng thử thật | VKINNO",
    description:
      "Cho nhà sáng tạo nội dung mẹo dọn nhà, chăm xe trên TikTok, Shopee Video, Reels: nhận bộ mẫu Bossman và VKINNO dùng thật, hoa hồng tiếp thị liên kết minh bạch.",
  },
  "/chinh-sach/": {
    title: "Chính sách đổi trả 7 ngày, giao hàng, bảo hành | VKINNO",
    description:
      "Đổi trả trong 7 ngày qua hotline 0938.791.389, thanh toán COD hoặc chuyển khoản VietQR, giao hàng toàn quốc, freeship đơn từ {freeship}. Xem đủ điều khoản.",
  },
} as const satisfies Record<string, SeoText>;

export type SeoPagePath = keyof typeof PAGE_SEO_TEMPLATES;

/** Tiêu đề/mô tả đã ghép giá cho một trang chính. */
export function pageSeo(path: SeoPagePath, vars: SeoVars = buildSeoVars()): SeoText {
  const t = PAGE_SEO_TEMPLATES[path];
  return { title: fillSeo(t.title, vars), description: fillSeo(t.description, vars) };
}
