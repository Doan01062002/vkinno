/**
 * ============================================================================
 * HỆ ĐIỀU HÀNH TỔNG KHO VKINNO — GOOGLE SHEETS + APPSHEET REALTIME (< 3 GIÂY)
 * Công ty TNHH Công nghệ Vĩnh Khang (VKINNO) · MST: 0107301786
 * Spreadsheet ID: 1Q2JtTSh63BWD0znOVNLkpXfR1aPqswc9y7u8l-Xaxvo
 * AppSheet App: https://www.appsheet.com/start/ced98270-b154-4be5-ada2-33887d06ea1f
 * Tài khoản VietQR đối soát: Vietcombank (VCB) 0491000082331
 * ============================================================================
 * TƯƠNG THÍCH TỰ ĐỘNG 100% VỚI CẢ 2 CẤU TRÚC SHEET:
 * - Chế độ A (AppSheet 5 Tab đang chạy thật trên Sheet 1Q2JtTSh63BWD0znOVNLkpXfR1aPqswc9y7u8l-Xaxvo):
 *   01_DANH_MUC_SKU, 02_QUAN_LY_LO_DATE, 03_NHAP_XUAT_KHO, 04_DON_HANG_LEADS, 05_TON_KHO_FEFO
 *   (Tự động ánh xạ mã SKU Web <-> mã SKU AppSheet và tách BOM Combo VK-CANXI-DAUMO-500ML
 *    thành 1 chai VK-TAY-CANXI-500ML + 1 chai VK-TAY-DAU-MO-500ML khi xuất kho!)
 * - Chế độ B (Workbook 7 Tab mở rộng):
 *   01_DANH_MUC_9_SKU .. 07_LOG_VIETQR_SEPAY
 * ============================================================================
 */

const CONFIG = {
  SPREADSHEET_ID: '1Q2JtTSh63BWD0znOVNLkpXfR1aPqswc9y7u8l-Xaxvo',
  APPSHEET_URL: 'https://www.appsheet.com/start/ced98270-b154-4be5-ada2-33887d06ea1f',
  VIETQR_ACCOUNT_NO: '0491000082331'
};

// Bảng ánh xạ chuẩn 1-1 giữa mã SKU Website vkinno.vn và mã SKU trên AppSheet hiện hành
const WEB_TO_APPSHEET_SKU = {
  'VK-SOLAR-SHIELD-5L': 'VK-SOLAR-SHIELD-5L',
  'VK-BOTTLE-SPRAY-500ML': 'VK-BINH-XIT-500ML',
  'VK-CLEARWAY-GLASSPRO-5L': 'VK-LAU-KINH-CAN-5L',
  'VK-CLEARWAY-GLASSPRO-500ML': 'VK-LAU-KINH-500ML',
  'VK-BOSSMAN-DESCALER-500ML': 'VK-TAY-CANXI-500ML',
  'VK-VISIONX-CLEAN-500ML': 'VK-XIT-O-KINH-500ML',
  'VK-CLEARWAY-AUTO-5L': 'VK-RUA-KINH-OTO-500ML',
  'VK-DEGREASER-500ML': 'VK-TAY-DAU-MO-500ML',
  'VK-COMBO-BOSSMAN-VKINNO-500ML': 'VK-CANXI-DAUMO-500ML'
};

function toAppSheetSku_(sku) {
  const s = String(sku || '').trim().toUpperCase();
  return WEB_TO_APPSHEET_SKU[s] || s;
}

function getTargetSpreadsheet_() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function isFiveTabAppSheet_(ss) {
  return ss.getSheetByName('04_DON_HANG_LEADS') !== null;
}

function getSecret_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowVnString_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
}

function sendTelegram_(text) {
  const token = getSecret_('TELEGRAM_BOT_TOKEN');
  const chatId = getSecret_('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
  } catch (err) {}
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧪 VKINNO All-in-One')
    .addItem('🔄 Quét & Trừ kho BOM cho các đơn ĐÃ ĐÓNG GÓI', 'syncPackedOrdersBomMenu')
    .addToUi();
}

/**
 * TỰ ĐỘNG TÁCH BOM TRỪ KHO KHI CHÚ ĐỒNG ĐỔI TRẠNG THÁI ĐƠN TRÊN APPSHEET / SHEETS
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const sName = sheet.getName();
  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < 2) return;

  // Chế độ 5 Tab AppSheet hiện hành: Tab 04_DON_HANG_LEADS, cột 13 (M) là Trang_Thai
  if (sName === '04_DON_HANG_LEADS' && col === 13) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(8000)) {
      try {
        handleFiveTabOrderBom_(sheet.getParent(), sheet, row);
      } finally {
        lock.releaseLock();
      }
    }
  }
}

/**
 * NHẬN TRUY VẤN REALTIME TỪ WEBSITE VKINNO.VN (< 1.5 GIÂY)
 */
function doGet(e) {
  const startedAt = Date.now();
  const params = (e && e.parameter) ? e.parameter : {};
  const action = String(params.action || 'health').trim();
  try {
    const ss = getTargetSpreadsheet_();
    if (action === 'health') {
      return jsonOut_({
        ok: true,
        service: 'VKINNO Google Sheets + AppSheet Realtime Gateway',
        spreadsheet_name: ss.getName(),
        schema_mode: isFiveTabAppSheet_(ss) ? 'APPSHEET_5_TAB_LIVE' : 'APPSHEET_7_TAB',
        appsheet_url: CONFIG.APPSHEET_URL,
        latency_ms: Date.now() - startedAt
      });
    }
    if (action === 'order.status' || action === 'order.track') {
      const code = String(params.code || '').trim().toUpperCase();
      const order = findOrderUniversal_(ss, code);
      if (!order) return jsonOut_({ ok: false, error: 'Không tìm thấy đơn hàng ' + code });
      return jsonOut_({ ok: true, order: order, latency_ms: Date.now() - startedAt });
    }
    return jsonOut_({ ok: true, latency_ms: Date.now() - startedAt });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/**
 * NHẬN ĐƠN HÀNG WEB, LEAD B2B/KOC & WEBHOOK VIETQR SEPAY REALTIME (< 2.5 GIÂY)
 */
function doPost(e) {
  const startedAt = Date.now();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return jsonOut_({ ok: false, error: 'Sheet đang bận xử lý đồng thời, vui lòng thử lại.' });
  }

  try {
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(rawBody);
    const configuredSecret = getSecret_('GOOGLE_SCRIPT_SECRET');
    const providedSecret = String(body.secret || (e.parameter && e.parameter.secret) || '');
    if (configuredSecret && configuredSecret !== providedSecret) {
      return jsonOut_({ ok: false, error: 'Unauthorized Webhook Secret' });
    }

    const ss = getTargetSpreadsheet_();
    const fiveTab = isFiveTabAppSheet_(ss);
    const action = String(body.action || (body.transferAmount !== undefined ? 'sepay.webhook' : '')).trim();

    // 1. GHI ĐƠN HÀNG MỚI VÀO 04_DON_HANG_LEADS (HOẶC 04_DON_HANG_DA_KENH)
    if (action === 'order.create') {
      const orderCode = String(body.order_code || '').trim().toUpperCase();
      const customerName = String(body.customer_name || 'Khách lẻ Web');
      const customerPhone = String(body.customer_phone || '');
      const shippingAddress = String(body.shipping_address || '');
      const channel = String(body.channel || 'Website vkinno.vn');
      const paymentMethod = String(body.payment_method || 'VIETQR').toUpperCase();
      const totalAmount = Number(body.total_amount || body.total_vnd || 0);
      const pickingGuide = String(body.picking_guide_text || '');
      const notes = String(body.notes || '');
      const items = Array.isArray(body.items) ? body.items : [];

      if (fiveTab) {
        const sh = ss.getSheetByName('04_DON_HANG_LEADS');
        const primarySku = items.length > 0 ? toAppSheetSku_(items[0].sku) : 'VK-CANXI-DAUMO-500ML';
        const totalQty = items.reduce(function(s, it) { return s + Number(it.quantity || 1); }, 0) || 1;
        const unitPrice = items.length > 0 ? Number(items[0].unit_price || totalAmount) : totalAmount;
        const prodSummary = String(body.items_summary || primarySku);
        const fullNote = (pickingGuide ? '[Nhặt kệ: ' + pickingGuide + '] ' : '') + notes;

        sh.appendRow([
          orderCode,
          nowVnString_(),
          customerName,
          "'" + customerPhone,
          shippingAddress,
          channel,
          primarySku,
          prodSummary,
          totalQty,
          unitPrice,
          totalAmount,
          paymentMethod,
          'CHO_THANH_TOAN',
          '',
          fullNote
        ]);
      } else {
        const sh = ss.getSheetByName('04_DON_HANG_DA_KENH');
        sh.appendRow([
          orderCode,
          nowVnString_(),
          channel,
          customerName,
          "'" + customerPhone,
          shippingAddress,
          String(body.items_summary || ''),
          pickingGuide,
          Number(body.subtotal_vnd || totalAmount),
          Number(body.discount_vnd || 0),
          Number(body.shipping_fee_vnd || 0),
          totalAmount,
          paymentMethod,
          'CHỜ THANH TOÁN',
          0,
          'CHỜ ĐÓNG GÓI',
          'NO',
          '',
          notes,
          JSON.stringify(items)
        ]);
      }

      SpreadsheetApp.flush();
      sendTelegram_(
        '🛒 [APPSHEET REALTIME] ĐƠN MỚI #' + orderCode + '\n' +
        '👤 Khách: ' + customerName + ' (' + customerPhone + ')\n' +
        '💰 Tổng: ' + totalAmount.toLocaleString('vi-VN') + 'đ (' + paymentMethod + ')\n' +
        '📦 Nhặt kệ: ' + pickingGuide
      );

      return jsonOut_({
        ok: true,
        order_code: orderCode,
        schema_mode: fiveTab ? '04_DON_HANG_LEADS' : '04_DON_HANG_DA_KENH',
        latency_ms: Date.now() - startedAt
      });
    }

    // 2. GHI LEAD B2B GARA/SOLAR & KOC
    if (action === 'lead.create') {
      const leadCode = 'LEAD-' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyMMddHHmmss');
      const leadType = String(body.lead_type || 'B2B').toUpperCase();
      const companyName = String(body.company_name || 'Cá nhân');
      const contactName = String(body.contact_name || '');
      const phone = String(body.phone || '');
      const city = String(body.city || '');
      const interest = String(body.interest || '');
      const volumeEstimate = String(body.volume_estimate || '');
      const message = String(body.message || '');

      if (fiveTab) {
        const sh = ss.getSheetByName('04_DON_HANG_LEADS');
        sh.appendRow([
          leadCode,
          nowVnString_(),
          contactName + ' (' + companyName + ')',
          "'" + phone,
          city,
          'LEAD_' + leadType,
          'VK-SOLAR-SHIELD-5L',
          interest || 'Đăng ký Đại lý B2B / KOC',
          1,
          0,
          0,
          'BAO_GIA_SI',
          'LEAD_MOI',
          '',
          'Sản lượng: ' + volumeEstimate + ' | Ghi chú: ' + message
        ]);
      } else {
        const sh = ss.getSheetByName('06_KHACH_SI_B2B_KOC');
        sh.appendRow([
          leadCode,
          nowVnString_(),
          leadType,
          companyName,
          contactName,
          "'" + phone,
          String(body.email || ''),
          city,
          interest,
          volumeEstimate,
          String(body.social_link || ''),
          message,
          'MỚI ĐĂNG KÝ',
          'Soạn báo giá sỉ B2B cho ' + companyName + ' (' + contactName + ' - ' + phone + ')'
        ]);
      }

      SpreadsheetApp.flush();
      return jsonOut_({
        ok: true,
        lead_code: leadCode,
        latency_ms: Date.now() - startedAt
      });
    }

    // 3. ĐỐI SOÁT VIETQR SEPAY TỰ ĐỘNG (< 2 GIÂY)
    if (action === 'sepay.webhook') {
      const transferType = String(body.transferType || body.transfer_type || 'in').trim();
      const accountNumber = String(body.accountNumber || body.account_number || '').trim();
      const transferAmount = Math.round(Number(body.transferAmount || body.transfer_amount || 0));
      const content = String(body.content || body.description || '');

      if (transferType !== 'in' || accountNumber !== CONFIG.VIETQR_ACCOUNT_NO || transferAmount <= 0) {
        return jsonOut_({ ok: true, ignored: true });
      }

      const match = content.match(/\b(VK[A-Z0-9]{4,12})\b/i);
      const extractedCode = match ? match[1].toUpperCase() : '';
      let matchedCode = '';
      let nextStatus = 'UNMATCHED';

      if (extractedCode) {
        if (fiveTab) {
          const sh = ss.getSheetByName('04_DON_HANG_LEADS');
          const vals = sh.getDataRange().getValues();
          for (let r = 1; r < vals.length; r++) {
            if (String(vals[r][0]).trim().toUpperCase() === extractedCode) {
              matchedCode = extractedCode;
              const needed = Number(vals[r][10] || 0);
              nextStatus = transferAmount >= needed ? 'DA_THANH_TOAN' : 'CHUYEN_THIEU';
              sh.getRange(r + 1, 13).setValue(nextStatus);
              break;
            }
          }
        } else {
          const sh = ss.getSheetByName('04_DON_HANG_DA_KENH');
          const vals = sh.getDataRange().getValues();
          for (let r = 1; r < vals.length; r++) {
            if (String(vals[r][0]).trim().toUpperCase() === extractedCode) {
              matchedCode = extractedCode;
              const needed = Number(vals[r][11] || 0);
              nextStatus = transferAmount >= needed ? 'ĐÃ THANH TOÁN' : 'CHUYỂN THIẾU';
              sh.getRange(r + 1, 14).setValue(nextStatus);
              sh.getRange(r + 1, 15).setValue(transferAmount);
              break;
            }
          }
        }
      }

      SpreadsheetApp.flush();
      return jsonOut_({
        ok: true,
        matched_order_code: matchedCode,
        match_status: nextStatus,
        latency_ms: Date.now() - startedAt
      });
    }

    return jsonOut_({ ok: false, error: 'Action không hợp lệ: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * TỰ ĐỘNG TÁCH BOM COMBO TRONG APPSHEET 5 TAB KHI ĐƠN CHUYỂN SANG ĐÃ ĐÓNG GÓI
 */
function handleFiveTabOrderBom_(ss, shOrders, rowIdx) {
  const row = shOrders.getRange(rowIdx, 1, 1, 15).getValues()[0];
  const orderCode = String(row[0] || '').trim();
  const skuRaw = toAppSheetSku_(row[6]);
  const qty = Math.max(1, Number(row[8] || 1));
  const status = String(row[12] || '').trim().toUpperCase();
  const note = String(row[14] || '');

  if ((status === 'DA_DONG_GOI' || status === 'ĐÃ ĐÓNG GÓI' || status === 'HOAN_THANH') && note.indexOf('[BOM_DEDUCTED]') < 0) {
    const shLog = ss.getSheetByName('03_NHAP_XUAT_KHO');
    if (!shLog) return;
    const txPrefix = 'TX-' + orderCode;

    if (skuRaw === 'VK-CANXI-DAUMO-500ML') {
      // Tách BOM Combo thành 2 dòng xuất kho chai lẻ trên 03_NHAP_XUAT_KHO
      shLog.appendRow([
        txPrefix + '-BM', nowVnString_(), 'XUAT_BAN', 'VK-TAY-CANXI-500ML',
        'LOT-VK-TAY-CANXI-01', qty, 69000, orderCode, 'AppSheet Auto BOM',
        'Tự động tách 01 chai Tẩy Cặn Canxi từ Combo ' + orderCode
      ]);
      shLog.appendRow([
        txPrefix + '-DG', nowVnString_(), 'XUAT_BAN', 'VK-TAY-DAU-MO-500ML',
        'LOT-VK-TAY-DAU-MO-01', qty, 85000, orderCode, 'AppSheet Auto BOM',
        'Tự động tách 01 chai Tẩy Dầu Mỡ từ Combo ' + orderCode
      ]);
    } else {
      shLog.appendRow([
        txPrefix, nowVnString_(), 'XUAT_BAN', skuRaw,
        '', qty, Number(row[9] || 0), orderCode, 'AppSheet Auto',
        'Xuất kho tự động đơn ' + orderCode
      ]);
    }
    shOrders.getRange(rowIdx, 15).setValue(note + ' [BOM_DEDUCTED]');
  }
}

function findOrderUniversal_(ss, code) {
  if (isFiveTabAppSheet_(ss)) {
    const sh = ss.getSheetByName('04_DON_HANG_LEADS');
    const vals = sh.getDataRange().getValues();
    for (let r = vals.length - 1; r >= 1; r--) {
      if (String(vals[r][0]).trim().toUpperCase() === code) {
        const st = String(vals[r][12] || '');
        return {
          order_code: String(vals[r][0]),
          created_at: String(vals[r][1]),
          customer_name: String(vals[r][2]),
          customer_phone: String(vals[r][3]).replace(/^'/, ''),
          shipping_address: String(vals[r][4]),
          channel: String(vals[r][5]),
          total_amount: Number(vals[r][10] || 0),
          payment_method: String(vals[r][11]),
          payment_status: st.indexOf('DA_THANH_TOAN') >= 0 ? 'PAID' : 'UNPAID',
          order_status: st,
          shipping_tracking_code: String(vals[r][13] || '')
        };
      }
    }
    return null;
  }
  return null;
}

function syncPackedOrdersBomMenu() {
  const ss = getTargetSpreadsheet_();
  if (isFiveTabAppSheet_(ss)) {
    const sh = ss.getSheetByName('04_DON_HANG_LEADS');
    const last = sh.getLastRow();
    for (let r = 2; r <= last; r++) {
      handleFiveTabOrderBom_(ss, sh, r);
    }
  }
  SpreadsheetApp.getUi().alert('Đã quét và đồng bộ trừ kho BOM tự động!');
}
