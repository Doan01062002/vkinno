// Kiểm tiêu đề SEO + meta description sau khi ghép giá từ products.ts (spec Marketing 02-seo-tieu-de-mo-ta.md).
import { describe, expect, it } from 'vitest';
import { products } from '../src/data/products';
import {
  PAGE_SEO_TEMPLATES,
  buildSeoVars,
  fillSeo,
  formatVndShort,
  pageSeo,
  productSeo,
  type SeoPagePath,
  type SeoVars,
} from '../src/data/seo';

const len = (s: string) => s.normalize('NFC').length;

/** Bản Marketing đã chốt (mục 4 của spec), viết với giá ngày 16/11/2026. */
const APPROVED_PRODUCTS: Record<string, { price: number; seo_title: string; meta_description: string }> = {
  'dung-dich-ve-sinh-tam-pin-mat-troi-solar-shield-dam-dac-giup-tang-hieu-suat-dien-tang-kem-binh-xit': {
    price: 295000,
    seo_title: 'Dung dịch vệ sinh tấm pin mặt trời Solar Shield 5L | VKINNO',
    meta_description:
      'Solar Shield can 5L đậm đặc, pha 1:20–1:30, pH trung tính, an toàn lớp phủ ARC và khung nhôm. Giá 295.000đ đã gồm VAT, tặng bình xịt 500ml, freeship.',
  },
  'bo-chai-xit-500ml-phun-suong': {
    price: 19000,
    seo_title: 'Bình xịt phun sương 500ml nhựa PET dày, có khóa | VKINNO',
    meta_description:
      'Chai xịt rỗng 500ml nhựa PET nguyên sinh, cò xịt kháng hóa chất pH 3–10.5, 2 chế độ phun sương và tia thẳng, có khóa OFF. Giá 19.000đ, mua kèm can 5L.',
  },
  'nuoc-lau-kinh-lam-sach-cuc-sau-khong-de-lai-vet-mo-can-5l-tang-kem-binh-xit-clearway-glasspro': {
    price: 155000,
    seo_title: 'Nước lau kính can 5L ClearWay, tặng bình xịt | VKINNO',
    meta_description:
      'ClearWay GlassPro can 5L dùng ngay không cần pha, không Amoniac, không Methanol, khô trong 10–15 giây. Giá 155.000đ đã gồm VAT, tặng kèm bình xịt 500ml.',
  },
  'nuoc-lau-kinh-clearway-glasspro-500ml-sach-nhanh-khong-vet-sang-bong-kinh-nha-van-phong': {
    price: 45000,
    seo_title: 'Nước lau kính 500ml ClearWay không vệt mờ, 45.000đ | VKINNO',
    meta_description:
      'Chai xịt lau kính ClearWay 500ml cho gương, cửa sổ, bàn kính: khô nhanh, không mùi Amoniac, pH trung tính. Giá 45.000đ, ghép Bộ 3 Toàn Gia 199.000đ để freeship.',
  },
  'chai-xit-tay-can-canxi-500ml-an-toan-cho-da-tay-dung-dich-tay-can-canxi-lam-sach-voi-sen-va-nha-tam': {
    price: 69000,
    seo_title: 'Tẩy cặn canxi kính nhà tắm, vòi sen Bossman 500ml | VKINNO',
    meta_description:
      'Bossman 500ml gốc acid hữu cơ, không HCl/HF: xịt, ủ 5–15 phút là cặn vôi trên vách kính, sen vòi Chrome, Inox 304 mềm ra dễ lau. Giá 69.000đ đã gồm VAT.',
  },
  'chai-xit-tay-rua-vet-o-kinh-logo-o-to-va-mang-dau-kinh-xit-lam-sach-sau-tiet-kiem-visionx-clean': {
    price: 75000,
    seo_title: 'Tẩy ố kính ô tô, màng dầu kính lái VisionX 500ml | VKINNO',
    meta_description:
      'VisionX Clean 500ml xử lý đốm ố nước mưa, màng dầu gây lóa đèn ban đêm và làm sáng logo Chrome. Không chứa HF, tự làm tại nhà. Giá 75.000đ đã gồm VAT.',
  },
  'nuoc-rua-kinh-o-to-chuyen-dung-clearway-chong-bam-nuoc-sach-sau-an-toan-voi-can-gat-va-be-mat-kinh': {
    price: 95000,
    seo_title: 'Nước rửa kính ô tô can 5L không Methanol | VKINNO',
    meta_description:
      'ClearWay can 5L đổ thẳng bình gạt mưa, không pha thêm nước. Nền nước Deion hạn chế tắc béc phun, gạt êm không kêu rít, không Methanol. Giá 95.000đ có VAT.',
  },
  'tay-dau-mo-da-nang-cao-cap-vkinno-500ml-chuyen-dung-cho-bep-tu-bep-hong-ngoai-an-toan-be-mat-bep': {
    price: 85000,
    seo_title: 'Tẩy dầu mỡ bếp từ, lưới máy hút mùi chai 500ml | VKINNO',
    meta_description:
      'Chai xịt bọt tẩy dầu mỡ 500ml không xút NaOH, không làm sùi đen lưới nhôm hút mùi, dùng được trên mặt kính bếp từ đã nguội. Hương chanh. Giá 85.000đ có VAT.',
  },
  'combo-chai-xit-tay-can-canxi-500ml-va-chai-tay-dau-mo-an-toan-da-tay-cong-thuc-moi-sach-vuot-troi---combobossmanvkinno-1782568108': {
    price: 145000,
    seo_title: 'Combo tẩy cặn canxi + tẩy dầu mỡ bếp 145.000đ | VKINNO',
    meta_description:
      'Combo Đôi Nhà Sạch: Bossman 500ml tẩy cặn canxi nhà tắm + VKINNO 500ml tẩy dầu mỡ bếp. Giá 145.000đ, rẻ hơn mua lẻ 9.000đ. Thêm chai lau kính để freeship.',
  },
};

const APPROVED_PAGES: Record<SeoPagePath, { seo_title: string; meta_description: string }> = {
  '/': {
    seo_title: 'Chất tẩy rửa sinh học nền nước Deion chính hãng | VKINNO',
    meta_description:
      'Tẩy cặn canxi Bossman, tẩy dầu mỡ bếp, nước lau kính, nước rửa kính ô tô và vệ sinh pin mặt trời. Giá đã gồm VAT, freeship từ 199.000đ, COD, đổi trả 7 ngày.',
  },
  '/san-pham/': {
    seo_title: 'Bảng giá chất tẩy rửa VKINNO: 9 sản phẩm, đã gồm VAT 8%',
    meta_description:
      '9 sản phẩm từ 19.000đ: tẩy cặn canxi, tẩy dầu mỡ, lau kính, rửa kính ô tô, vệ sinh pin mặt trời. Combo Đôi Nhà Sạch 145.000đ, Bộ 3 Toàn Gia 199.000đ freeship.',
  },
  '/gioi-thieu/': {
    seo_title: 'Giới thiệu VKINNO – Công ty TNHH Công nghệ Vĩnh Khang',
    meta_description:
      'VKINNO là thương hiệu của Công ty TNHH Công nghệ Vĩnh Khang (MST 0107301786, Hà Nội), sản xuất chất tẩy rửa nền nước Deion cho gia đình, ô tô và điện mặt trời.',
  },
  '/lien-he/': {
    seo_title: 'Liên hệ VKINNO: hotline 0938.791.389, Zalo, kho Hà Nội',
    meta_description:
      'Gọi 0938.791.389 hoặc nhắn Zalo để được tư vấn chọn sản phẩm, báo giá sỉ gara, đại lý. Văn phòng tại Cầu Giấy, kho xuất hàng tại Di Trạch, Hoài Đức, Hà Nội.',
  },
  '/giai-phap-gara/': {
    seo_title: 'Giá sỉ cho gara ô tô, chiết khấu 20–40% | VKINNO',
    meta_description:
      'Chiết khấu sỉ 20–40% trên giá lẻ cho gara ô tô, Car Care và nhà thầu O&M điện mặt trời: nước rửa kính ClearWay 5L, tẩy ố VisionX, Solar Shield 5L. Giá gồm VAT.',
  },
  '/bossman-creator/': {
    seo_title: 'Đăng ký KOC Bossman: nhận mẫu dùng thử thật | VKINNO',
    meta_description:
      'Cho nhà sáng tạo nội dung mẹo dọn nhà, chăm xe trên TikTok, Shopee Video, Reels: nhận bộ mẫu Bossman và VKINNO dùng thật, hoa hồng tiếp thị liên kết minh bạch.',
  },
  '/chinh-sach/': {
    seo_title: 'Chính sách đổi trả 7 ngày, giao hàng, bảo hành | VKINNO',
    meta_description:
      'Đổi trả trong 7 ngày qua hotline 0938.791.389, thanh toán COD hoặc chuyển khoản VietQR, giao hàng toàn quốc, freeship đơn từ 199.000đ. Xem đủ điều khoản.',
  },
};

/** Biến giá đúng ngày Marketing chốt bản viết. */
const APPROVED_VARS: SeoVars = {
  bo3: 199000,
  combo: 145000,
  combo_saving: 9000,
  min_price: 19000,
  freeship: 199000,
  count: 9,
};

function expectInRange(title: string, description: string) {
  expect(title).not.toMatch(/[{}]/);
  expect(description).not.toMatch(/[{}]/);
  expect(title).toContain('VKINNO');
  expect(len(title), title).toBeGreaterThanOrEqual(45);
  expect(len(title), title).toBeLessThanOrEqual(60);
  expect(len(description), description).toBeGreaterThanOrEqual(140);
  expect(len(description), description).toBeLessThanOrEqual(160);
}

describe('SEO: ghép giá vào tiêu đề/mô tả', () => {
  it('định dạng giá kiểu 45.000đ', () => {
    expect(formatVndShort(45000)).toBe('45.000đ');
    expect(formatVndShort(295000)).toBe('295.000đ');
    expect(formatVndShort(1250000)).toBe('1.250.000đ');
    expect(formatVndShort(900)).toBe('900đ');
  });

  it('báo lỗi khi mẫu dùng biến không có', () => {
    expect(() => fillSeo('Giá {gia_la}', APPROVED_VARS)).toThrow(/gia_la/);
    expect(() => fillSeo('Giá {price}', APPROVED_VARS)).toThrow(/price/);
  });

  it('biến tính từ products.ts khớp giá đang bán', () => {
    const v = buildSeoVars();
    const byS = (sku: string) => products.find((p) => p.sku === sku)!.price_vnd;
    expect(v.bo3).toBe(byS('VK-BOSSMAN-DESCALER-500ML') + byS('VK-DEGREASER-500ML') + byS('VK-CLEARWAY-GLASSPRO-500ML'));
    expect(v.combo_saving).toBe(byS('VK-BOSSMAN-DESCALER-500ML') + byS('VK-DEGREASER-500ML') - byS('VK-COMBO-BOSSMAN-VKINNO-500ML'));
    expect(v.count).toBe(products.length);
  });

  it('cả 9 sản phẩm đều có mẫu SEO, độ dài thực sau ghép giá hiện hành nằm trong 45–60 / 140–160', () => {
    expect(products).toHaveLength(9);
    for (const p of products) {
      expect(p.seo_title, p.slug).toBeTruthy();
      expect(p.meta_description, p.slug).toBeTruthy();
      expect(p.meta_description, `${p.slug}: giá phải là biến, không gõ cứng`).not.toMatch(/\d{1,3}\.000đ/);
      const s = productSeo(p);
      expectInRange(s.title, s.description);
    }
  });

  it('7 trang chính: độ dài thực sau ghép giá hiện hành nằm trong 45–60 / 140–160', () => {
    for (const path of Object.keys(PAGE_SEO_TEMPLATES) as SeoPagePath[]) {
      const s = pageSeo(path);
      expectInRange(s.title, s.description);
    }
  });

  it('với giá ngày chốt, ra đúng nguyên văn bản Marketing đã duyệt', () => {
    for (const [slug, a] of Object.entries(APPROVED_PRODUCTS)) {
      const p = products.find((x) => x.slug === slug);
      expect(p, slug).toBeDefined();
      const s = productSeo({ ...p!, price_vnd: a.price }, APPROVED_VARS);
      expect(s.title).toBe(a.seo_title);
      expect(s.description).toBe(a.meta_description);
    }
    for (const [path, a] of Object.entries(APPROVED_PAGES) as [SeoPagePath, (typeof APPROVED_PAGES)[SeoPagePath]][]) {
      const s = pageSeo(path, APPROVED_VARS);
      expect(s.title).toBe(a.seo_title);
      expect(s.description).toBe(a.meta_description);
    }
  });
});
