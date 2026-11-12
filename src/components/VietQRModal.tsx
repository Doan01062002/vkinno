import React from "react";
import { SITE_CONFIG, buildVietQrImageUrl } from "../data/siteConfig";

interface VietQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: number;
  orderCode: string;
}

export const VietQRModal: React.FC<VietQRModalProps> = ({
  isOpen,
  onClose,
  amount,
  orderCode,
}) => {
  if (!isOpen) return null;
  const safeCode = orderCode || "VKINNO";
  const qrUrl = buildVietQrImageUrl(amount, safeCode);

  return (
    <div className="fixed inset-0 z-[250] bg-slate-950/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-extrabold text-lg text-slate-900">
            Thanh toán VietQR Chính Hãng
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ QR"
            className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-4 bg-white border-2 border-[#1E2B6B] rounded-2xl flex justify-center">
          <img
            src={qrUrl}
            alt={`Mã VietQR đơn hàng ${safeCode}`}
            width={240}
            height={240}
            className="w-60 h-60 object-contain"
          />
        </div>

        <div className="bg-slate-50 rounded-xl p-3.5 text-sm space-y-1.5 border border-slate-200 tabular-nums">
          <p>
            <strong>Ngân hàng:</strong> {SITE_CONFIG.bank.shortName}
          </p>
          <p>
            <strong>Số tài khoản:</strong>{" "}
            <span className="font-extrabold text-[#1E2B6B]">{SITE_CONFIG.bank.accountNo}</span>
          </p>
          <p>
            <strong>Chủ TK:</strong> {SITE_CONFIG.bank.accountName}
          </p>
          <p>
            <strong>Số tiền:</strong>{" "}
            <span className="font-extrabold text-[#C81E1E]">
              {amount.toLocaleString("vi-VN")} ₫
            </span>
          </p>
          <p>
            <strong>Nội dung CK:</strong>{" "}
            <span className="font-mono font-extrabold bg-amber-100 text-slate-900 px-2 py-0.5 rounded">
              {safeCode}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};
