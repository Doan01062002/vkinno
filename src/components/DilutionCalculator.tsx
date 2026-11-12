import React, { useState, useId, useEffect, useRef } from "react";
import { Sun, Car, Wrench, ShieldCheck, CheckCircle2, Sparkles, Droplets, ArrowRight } from "lucide-react";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  formatter?: (val: number) => string;
}

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, decimals = 0, formatter }) => {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const prevValueRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = prevValueRef.current;
    const endValue = value;
    const startTime = performance.now();
    const duration = 380; // ms

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * ease;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevValueRef.current = endValue;
        setDisplayValue(endValue);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  if (formatter) {
    return <>{formatter(displayValue)}</>;
  }

  return (
    <>
      {decimals > 0
        ? displayValue.toFixed(decimals)
        : Math.round(displayValue).toLocaleString("vi-VN")}
    </>
  );
};

export const DilutionCalculator: React.FC = () => {
  const [appType, setAppType] = useState<"solar" | "car" | "degreaser">("solar");
  const [scale, setScale] = useState<number>(50);
  const [dirtLevel, setDirtLevel] = useState<"light" | "medium" | "heavy">("medium");

  const ratioConfig = {
    solar: {
      title: "Vệ Sinh Tấm Pin Mặt Trời (Solar Shield)",
      unitName: "Tấm Pin Quang Điện",
      unitShort: "Tấm",
      minScale: 10,
      maxScale: 500,
      step: 10,
      presets: [20, 50, 150, 300, 500],
      liquidPerUnitMl: 400,
      ratios: { light: 30, medium: 20, heavy: 10 },
      ratioLabels: { 
        light: "1:30 (Bụi mỏng, rửa định kỳ 1 tháng)", 
        medium: "1:20 (Bụi dày, phấn hoa, màng sương)", 
        heavy: "1:10 (Rêu xanh, phân chim bám kết)" 
      },
      recommendedSku: "VK-SOLAR-SHIELD-5L",
      skuName: "Dung dịch Solar Shield can 5L",
      skuPrice: 295000,
      skuVolumeL: 5,
      mechanismNote: "Bảo toàn 100% lớp phủ quang học nano ARC, không ăn mòn khung nhôm Anodized.",
      badge: "ARC SAFE • 100% DEION",
    },
    car: {
      title: "Chăm Sóc Kính & Ô Tô (ClearWay Pro)",
      unitName: "Lượt Rửa Kính / Xe Chi Tiết",
      unitShort: "Xe",
      minScale: 5,
      maxScale: 200,
      step: 5,
      presets: [10, 25, 50, 100, 200],
      liquidPerUnitMl: 600,
      ratios: { light: 40, medium: 25, heavy: 10 },
      ratioLabels: { 
        light: "1:40 (Lau kính hàng ngày tạo bóng)", 
        medium: "1:25 (Rửa xe tiêu chuẩn gara)", 
        heavy: "1:10 (Kính ố mốc vảy cá, cặn canxi)" 
      },
      recommendedSku: "VK-CLEARWAY-GLASSPRO-5L",
      skuName: "Nước lau kính ClearWay Pro can 5L",
      skuPrice: 155000,
      skuVolumeL: 5,
      mechanismNote: "Hiệu ứng lá sen trôi nước chống đọng hạt, an toàn cho lưỡi gạt mưa cao su khi pha đúng hướng dẫn.",
      badge: "ANTI-STREAK • HIỆU ỨNG LÁ SEN",
    },
    degreaser: {
      title: "Tẩy Dầu Mỡ Sinh Học (Bio-Degreaser)",
      unitName: "M² Bề Mặt Khoang Máy / Bếp Từ",
      unitShort: "M²",
      minScale: 5,
      maxScale: 100,
      step: 5,
      presets: [5, 15, 30, 60, 100],
      liquidPerUnitMl: 250,
      ratios: { light: 15, medium: 8, heavy: 3 },
      ratioLabels: { 
        light: "1:15 (Dầu mỡ bề mặt bếp mới)", 
        medium: "1:8 (Dầu mỡ két dày lâu ngày)", 
        heavy: "1:3 (Dầu mỡ cháy đen khét lẹt)" 
      },
      recommendedSku: "VK-DEGREASER-500ML",
      skuName: "Chai xịt tẩy dầu mỡ đa năng 500ml",
      skuPrice: 85000,
      skuVolumeL: 0.5,
      mechanismNote: "100% Không xút (No NaOH), bảo vệ tấm lưới nhôm hút mùi và mặt kính bếp từ.",
      badge: "NO NaOH • AN TOÀN DA TAY",
    },
  };

  const currentConfig = ratioConfig[appType];
  const ratioWaterPart = currentConfig.ratios[dirtLevel];

  // Mathematical Calculations
  const totalMixedLiquidMl = scale * currentConfig.liquidPerUnitMl;
  const totalMixedLiquidL = Math.round((totalMixedLiquidMl / 1000) * 10) / 10;
  
  const concentrateNeededL = Math.round((totalMixedLiquidL / (1 + ratioWaterPart)) * 100) / 100;
  const waterNeededL = Math.round((totalMixedLiquidL - concentrateNeededL) * 10) / 10;

  const cansNeeded = Math.max(1, Math.ceil(concentrateNeededL / currentConfig.skuVolumeL));
  const totalCost = cansNeeded * currentConfig.skuPrice;
  const costPerUnit = Math.round(totalCost / Math.max(1, scale));

  // Fluid Ratio Proportion
  const concentratePercent = Math.round((1 / (1 + ratioWaterPart)) * 1000) / 10;
  const waterPercent = Math.round((ratioWaterPart / (1 + ratioWaterPart)) * 1000) / 10;

  const sliderProgress = Math.max(0, Math.min(100, Math.round(((scale - currentConfig.minScale) / (currentConfig.maxScale - currentConfig.minScale)) * 100)));

  const scaleInputId = useId();

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-9 text-[#0f172a] shadow-xl border border-slate-200/80 relative overflow-hidden">
      
      {/* Decorative High-Tech Background Glow */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-sky-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20"></div>

      <div className="relative z-10 space-y-7">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-sky-50 border border-sky-200 text-[#0284c7] text-xs font-bold uppercase tracking-wider font-mono">
            <Sparkles className="w-3.5 h-3.5 text-[#0284c7] animate-spin" style={{ animationDuration: '6s' }} />
            <span>Thuật Toán Định Mức Khoa Học VKINNO Lab</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0f172a]">
            BẢNG TÍNH TỈ LỆ PHA LOÃNG & CHI PHÍ
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 max-w-xl mx-auto leading-relaxed">
            Nhập diện tích tấm pin hoặc quy mô xưởng để hệ thống tính toán chính xác lượng dung dịch đậm đặc và nước Deion cần pha, tránh lãng phí hóa chất.
          </p>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
          <button
            type="button"
            onClick={() => {
              setAppType("solar");
              setScale(50);
            }}
            className={`py-3 px-3 rounded-xl text-xs sm:text-sm font-bold font-display tracking-tight transition-all flex items-center justify-center gap-2 cursor-pointer ${
              appType === "solar"
                ? "bg-white text-[#0284c7] shadow-md border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Sun className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="truncate">Pin Mặt Trời</span>
          </button>
          
          <button
            type="button"
            onClick={() => {
              setAppType("car");
              setScale(25);
            }}
            className={`py-3 px-3 rounded-xl text-xs sm:text-sm font-bold font-display tracking-tight transition-all flex items-center justify-center gap-2 cursor-pointer ${
              appType === "car"
                ? "bg-white text-[#0284c7] shadow-md border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Car className="w-4 h-4 text-sky-500 shrink-0" />
            <span className="truncate">Kính Ô Tô</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAppType("degreaser");
              setScale(15);
            }}
            className={`py-3 px-3 rounded-xl text-xs sm:text-sm font-bold font-display tracking-tight transition-all flex items-center justify-center gap-2 cursor-pointer ${
              appType === "degreaser"
                ? "bg-white text-[#0284c7] shadow-md border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Wrench className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="truncate">Tẩy Dầu Mỡ</span>
          </button>
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-2xl bg-slate-50 border border-slate-200/80">
          
          {/* Scale Slider & Presets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor={scaleInputId} className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Quy mô: {currentConfig.unitName}
              </label>
              <span className="text-sm font-black text-[#0284c7] bg-white px-3 py-1 rounded-lg border border-slate-200 font-mono shadow-xs">
                <AnimatedNumber value={scale} /> {currentConfig.unitShort}
              </span>
            </div>

            {/* Slider with dynamic background */}
            <input
              id={scaleInputId}
              type="range"
              min={currentConfig.minScale}
              max={currentConfig.maxScale}
              step={currentConfig.step}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, #0284c7 0%, #06b6d4 ${sliderProgress}%, #cbd5e1 ${sliderProgress}%, #cbd5e1 100%)`,
              }}
              className="w-full h-3 rounded-lg appearance-none cursor-pointer accent-[#0284c7] transition-all"
            />

            {/* Scale Presets */}
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] text-slate-400 font-medium">Gợi ý:</span>
              <div className="flex flex-wrap gap-1">
                {currentConfig.presets.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setScale(val)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer active:scale-95 ${
                      scale === val 
                        ? "bg-[#0284c7] text-white shadow-xs" 
                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dirt Level Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
              Mức độ bám bẩn bề mặt:
            </label>

            <div className="grid grid-cols-3 gap-2">
              {(["light", "medium", "heavy"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDirtLevel(level)}
                  className={`p-3 rounded-xl text-center border transition-all cursor-pointer flex flex-col items-center justify-center gap-1 active:scale-95 ${
                    dirtLevel === level
                      ? "bg-white border-[#0284c7] text-[#0284c7] shadow-sm ring-2 ring-sky-500/20"
                      : "bg-white/70 border-slate-200 text-slate-600 hover:bg-white"
                  }`}
                >
                  <span className="font-bold text-xs">
                    {level === "light" ? "Bụi nhẹ" : level === "medium" ? "Bụi vừa" : "Bám nặng"}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 font-semibold">
                    1:{currentConfig.ratios[level]}
                  </span>
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-500 italic">
              {currentConfig.ratioLabels[dirtLevel]}
            </p>
          </div>

        </div>

        {/* Visual Fluid Ratio Proportion Bar */}
        <div className="space-y-2 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-1.5 text-[#0284c7] font-bold">
              <Droplets className="w-3.5 h-3.5" />
              Nước Deion Siêu Tinh Khiết: <AnimatedNumber value={waterPercent} decimals={1} />%
            </span>
            <span className="text-emerald-700 font-bold">
              Chế phẩm đậm đặc: <AnimatedNumber value={concentratePercent} decimals={1} />%
            </span>
          </div>

          <div className="w-full h-3 rounded-full bg-slate-200 overflow-hidden flex shadow-inner">
            <div 
              style={{ width: `${waterPercent}%` }} 
              className="bg-gradient-to-r from-sky-400 to-[#0284c7] transition-all duration-300"
              title={`Nước Deion: ${waterPercent}%`}
            ></div>
            <div 
              style={{ width: `${concentratePercent}%` }} 
              className="bg-gradient-to-r from-emerald-400 to-[#10b981] transition-all duration-300"
              title={`Đậm đặc: ${concentratePercent}%`}
            ></div>
          </div>
        </div>

        {/* Dynamic Calculation Results Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          
          <div className="p-4 rounded-2xl bg-white border border-slate-200 text-center shadow-xs hover:border-[#0284c7] transition-colors">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Dung Dịch Đậm Đặc</span>
            <div className="text-2xl font-black text-[#0284c7] font-display">
              <AnimatedNumber value={concentrateNeededL} decimals={2} /> <span className="text-xs font-semibold text-slate-600">L</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-bold font-mono block mt-1">Cần {cansNeeded} can/bình</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 text-center shadow-xs hover:border-[#0284c7] transition-colors">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Nước Deion Cần Pha</span>
            <div className="text-2xl font-black text-slate-800 font-display">
              <AnimatedNumber value={waterNeededL} decimals={1} /> <span className="text-xs font-semibold text-slate-600">L</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono block mt-1">≥10 MΩ·cm</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 text-center shadow-xs hover:border-[#0284c7] transition-colors">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Tổng Dung Dịch Thu Được</span>
            <div className="text-2xl font-black text-slate-800 font-display">
              <AnimatedNumber value={totalMixedLiquidL} decimals={1} /> <span className="text-xs font-semibold text-slate-600">L</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono block mt-1">Sẵn sàng sử dụng</span>
          </div>

          <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0f172a] to-[#1e293b] text-white text-center shadow-md">
            <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 block mb-1">Chi Phí / Đơn Vị</span>
            <div className="text-2xl font-black text-emerald-400 font-display">
              <AnimatedNumber 
                value={costPerUnit} 
                formatter={(val) => new Intl.NumberFormat("vi-VN").format(Math.round(val))} 
              /> <span className="text-xs font-normal text-white">₫</span>
            </div>
            <span className="text-[11px] text-cyan-300 font-bold block mt-1">Tiết kiệm &gt;45%</span>
          </div>

        </div>

        {/* Mechanism Guarantee Pill */}
        <div className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-200 flex items-start gap-3 text-xs text-slate-700">
          <CheckCircle2 className="w-4 h-4 text-[#0284c7] shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong>Cam kết khoa học: </strong>
            {currentConfig.mechanismNote} Nền nước Deion điện trở suất &ge;10 M&Omega;&middot;cm đảm bảo không tạo cặn vôi ion kim loại.
          </div>
        </div>

        {/* Bottom CTA Row */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200">
          <div className="text-xs text-slate-600 text-center sm:text-left">
            <span>Sản phẩm tương ứng: </span>
            <strong className="text-slate-900">{currentConfig.skuName}</strong>
            <span className="text-[#0284c7] font-bold ml-1 font-mono">
              ({new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(currentConfig.skuPrice)})
            </span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <a
              href="/san-pham"
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-[#0284c7] to-[#0369a1] hover:from-[#0369a1] hover:to-[#075985] text-white font-bold text-xs uppercase tracking-wider transition text-center shadow-md flex items-center justify-center gap-1.5"
            >
              <span>Xem Sản Phẩm Can 5L</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

      </div>
    </div>
  );
};
