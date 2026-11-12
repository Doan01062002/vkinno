export const SITE_CONFIG = {
  projectSlug: "chu-dong-vkinno",
  brandName: "VKINNO",
  legalName: "CÔNG TY TNHH CÔNG NGHỆ VĨNH KHANG",
  legalFullDisplay: "CÔNG TY TNHH CÔNG NGHỆ VĨNH KHANG (VKINNO)",
  taxId: "0107301786",
  taxIssuer: "Sở Kế hoạch & Đầu tư TP. Hà Nội",
  legalRepresentative: "Ông Nguyễn Vĩnh Khang",
  legalRepTitle: "Giám đốc",
  registeredAddress:
    "Số 24 ngõ 16 Phan Văn Trường, Phường Dịch Vọng Hậu, Quận Cầu Giấy, TP. Hà Nội",
  warehouseAddress:
    "Nhà Công vụ Di Trạch, đường Di Ái, Xã Di Trạch, Huyện Hoài Đức, TP. Hà Nội",
  hotlinePrimary: "0938.791.389",
  hotlinePrimaryTel: "0938791389",
  hotlineSecondary: "0399.173.777",
  hotlineSecondaryTel: "0399173777",
  zaloUrl: "https://zalo.me/0938791389",
  email: "support@vkinno.com",
  siteUrl: "https://vkinno.vn",
  defaultOgImage: "/images/og-vkinno.jpg",
  boCongThuongUrl:
    "https://online.gov.vn/nen-tang/16cfebb4-5d7d-47f7-b03c-b7b556b3ff6a",
  boCongThuongBadge: "/images/bo-cong-thuong.svg",
  shopeeUrl: "https://shopee.vn/vinhkhangsuckhoe",
  facebookUrl: "https://www.facebook.com/profile.php?id=61581410145853",
  gtmId: "GTM-K2TSSLGM",
  googleAdsId: "AW-970340726",
  freeshipThresholdVnd: 199000,
  flatShippingFeeVnd: 25000,
  bank: {
    code: "VCB",
    bin: "970436",
    bankName: "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)",
    shortName: "Vietcombank (VCB)",
    accountNo: "0491000082331",
    accountName: "CONG TY TNHH CONG NGHE VINH KHANG",
  },
} as const;

export function buildVietQrImageUrl(amountVnd: number, orderCode: string): string {
  const params = new URLSearchParams({
    amount: String(Math.max(0, Math.round(amountVnd))),
    addInfo: orderCode,
    accountName: SITE_CONFIG.bank.accountName,
  });
  return `https://img.vietqr.io/image/${SITE_CONFIG.bank.bin}-${SITE_CONFIG.bank.accountNo}-compact2.png?${params.toString()}`;
}
