import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { PageHeader } from '../components/PageHeader';
import { ProductPicker, type PriceTier } from '../components/ProductPicker';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch, fieldErrors, type ListResult } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { MANUAL_CHANNEL_LABELS, MANUAL_CHANNELS, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../lib/orderFlow';
import type { OrderDetailData } from './orders/types';
import { useDebounced } from '../lib/useDebounced';

interface CustomerRow {
  id: number;
  phone: string;
  name: string;
  address: string;
  email: string;
  price_tier: PriceTier;
}

interface Line {
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
}

/** SĐT về dạng 0xxxxxxxxx để so khớp với khách đã lưu (+84…, 84…, có dấu cách/chấm). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (digits.startsWith('84') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

/** Tạo đơn tay (Zalo, điện thoại, Facebook, B2B): tìm khách theo SĐT, chọn hàng theo hạng giá của khách. */
export function OrderCreate() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [channel, setChannel] = useState<string>('ZALO');
  const [method, setMethod] = useState<string>('CASH');
  const [lines, setLines] = useState<Line[]>([]);
  const [shippingFee, setShippingFee] = useState<number | null>(0);
  const [discount, setDiscount] = useState<number | null>(0);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const debouncedPhone = useDebounced(phone, 300);
  const wanted = normalizePhone(debouncedPhone);
  // Chỉ tra cứu SĐT đầy đủ: không có ký tự che (*) và đủ 10 số.
  const lookable = /^[\d\s+().-]+$/.test(debouncedPhone.trim()) && wanted.length >= 10;
  const lookup = useQuery({
    queryKey: ['/customers', 'lookup', wanted],
    enabled: lookable,
    queryFn: () => apiFetch<ListResult<CustomerRow>>('/customers', { query: { q: wanted, page_size: 5 } }),
  });
  const found = lookable ? (lookup.data?.items.find((c) => c.phone === wanted) ?? null) : null;

  // Khách cũ: tự điền tên/địa chỉ và lấy hạng giá. Chỉ thay/xoá chữ do chính lần tự điền trước đặt;
  // chữ người dùng đã gõ (khác giá trị tự điền) không bao giờ bị ghi đè.
  const auto = useRef({ name: '', address: '' });
  useEffect(() => {
    setCustomer(found);
    const prev = auto.current;
    const next = { name: found?.name ?? '', address: found?.address ?? '' };
    setName((cur) => (cur === '' || cur === prev.name ? next.name : cur));
    setAddress((cur) => (cur === '' || cur === prev.address ? next.address : cur));
    auto.current = next;
  }, [found]);

  const tier: PriceTier = customer?.price_tier ?? 'RETAIL';
  const subtotal = lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0);
  const total = subtotal - (discount ?? 0) + (shippingFee ?? 0);

  const addLine = (sku: string, qty: number, p: { name: string; unit: string; unit_price_vnd: number }) =>
    setLines((cur) =>
      cur.some((l) => l.sku === sku)
        ? cur.map((l) => (l.sku === sku ? { ...l, quantity: l.quantity + qty } : l))
        : [...cur, { sku, name: p.name, unit: p.unit, quantity: qty, unitPrice: p.unit_price_vnd }],
    );
  const patchLine = (sku: string, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));

  const create = useMutation({
    mutationFn: (body: unknown) => apiFetch<OrderDetailData>('/orders', { method: 'POST', json: body }),
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: ['/orders'] });
      void qc.invalidateQueries({ queryKey: ['/customers'] });
      void qc.invalidateQueries({ queryKey: ['product-picker'] });
      void qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/inventory'),
      });
      toast.success(`Đã tạo đơn ${order.order_code}.`);
      navigate(`/don-hang/${order.id}`);
    },
    onError: (e, body) => {
      setErrors(fieldErrors(e));
      setFormError(e instanceof ApiClientError ? e.message : '');
      if (e instanceof ApiClientError && e.status === 0) {
        toast.error(e, { action: { label: 'Thử lại', onClick: () => create.mutate(body) } });
      } else toast.error(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!phone.trim()) next.phone = 'Vui lòng nhập số điện thoại.';
    if (!name.trim()) next.name = 'Vui lòng nhập tên khách.';
    if (lines.length === 0) next.items = 'Đơn cần ít nhất một sản phẩm.';
    if ((discount ?? 0) > subtotal) next.discount_vnd = 'Giảm giá không được lớn hơn tạm tính.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length > 0) return;
    create.mutate({
      channel,
      customer: { phone: phone.trim(), name: name.trim(), address: address.trim() },
      shipping_address: address.trim(),
      notes: notes.trim(),
      items: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit_price: l.unitPrice ?? 0 })),
      shipping_fee_vnd: shippingFee ?? 0,
      discount_vnd: discount ?? 0,
      payment_method: method,
    });
  };

  const picked = Object.fromEntries(lines.map((l) => [l.sku, l.quantity]));

  return (
    <>
      <PageHeader
        title="Tạo đơn hàng"
        description="Đơn nhập tay sẽ giữ hàng ngay; tồn thực tế chỉ giảm khi đóng gói."
        actions={
          <Link to="/don-hang" className={buttonClass('secondary')}>
            Quay lại danh sách
          </Link>
        }
      />
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        <section className="space-y-4 rounded-xl border border-line bg-surface p-4" aria-label="Khách hàng">
          <h2 className="text-sm font-semibold text-fg">Khách hàng</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Số điện thoại"
              htmlFor="order-phone"
              required
              error={errors.phone}
              hint={
                customer ? (
                  <span className="text-success">
                    Khách cũ: {customer.name} · Hạng giá {customer.price_tier === 'WHOLESALE' ? 'sỉ' : 'lẻ'}
                  </span>
                ) : undefined
              }
            >
              <input
                id="order-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={errors.phone ? true : undefined}
                className={inputClass}
              />
            </Field>
            <Field label="Tên khách" htmlFor="order-name" required error={errors.name ?? errors.customer}>
              <input
                id="order-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errors.name ? true : undefined}
                className={inputClass}
              />
            </Field>
            <Field label="Địa chỉ giao hàng" htmlFor="order-address" className="sm:col-span-2" error={errors.shipping_address}>
              <input id="order-address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Kênh bán" htmlFor="order-channel">
              <select id="order-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
                {MANUAL_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {MANUAL_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Phương thức thanh toán" htmlFor="order-method">
              <select id="order-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                {MANUAL_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="Sản phẩm">
          <h2 className="text-sm font-semibold text-fg">Sản phẩm</h2>
          {errors.items && (
            <p role="alert" className="text-sm text-danger">
              {errors.items}
            </p>
          )}
          {lines.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {lines.map((l) => (
                <li key={l.sku} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-medium text-fg">{l.name}</p>
                    <p className="text-xs text-muted">{l.sku}</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    aria-label={`Số lượng ${l.sku}`}
                    value={l.quantity}
                    onChange={(e) => patchLine(l.sku, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                    className={`${inputClass} w-24`}
                  />
                  <MoneyInput
                    value={l.unitPrice}
                    onChange={(v) => patchLine(l.sku, { unitPrice: v })}
                    className="w-36"
                    placeholder="Đơn giá"
                  />
                  <span className="w-28 text-right text-sm font-medium text-fg" aria-label={`Thành tiền ${l.sku}`}>
                    {formatVnd(l.quantity * (l.unitPrice ?? 0))}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Xoá ${l.sku}`}
                    onClick={() => setLines((cur) => cur.filter((x) => x.sku !== l.sku))}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ProductPicker priceTier={tier} picked={picked} disabled={create.isPending} onPick={addLine} />
          {customer && lines.length > 0 && (
            <p className="text-xs text-muted">Giá các dòng đã thêm giữ nguyên; sản phẩm thêm sau lấy theo hạng giá của khách.</p>
          )}
        </section>

        <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2" aria-label="Thanh toán">
          <Field label="Phí vận chuyển" htmlFor="order-ship" error={errors.shipping_fee_vnd}>
            <MoneyInput id="order-ship" value={shippingFee} onChange={setShippingFee} />
          </Field>
          <Field label="Giảm giá" htmlFor="order-discount" error={errors.discount_vnd}>
            <MoneyInput id="order-discount" value={discount} onChange={setDiscount} />
          </Field>
          <Field label="Ghi chú" htmlFor="order-notes" className="sm:col-span-2">
            <textarea id="order-notes" rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>
          <dl className="space-y-1 text-sm sm:col-span-2">
            <div className="flex justify-between">
              <dt className="text-muted">Tạm tính ({formatNumber(lines.reduce((s, l) => s + l.quantity, 0))} sản phẩm)</dt>
              <dd data-testid="subtotal">{formatVnd(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Giảm giá</dt>
              <dd>{(discount ?? 0) > 0 ? `-${formatVnd(discount ?? 0)}` : formatVnd(0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Phí vận chuyển</dt>
              <dd>{formatVnd(shippingFee ?? 0)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-fg">
              <dt>Tổng cộng</dt>
              <dd data-testid="total">{formatVnd(total)}</dd>
            </div>
          </dl>
        </section>

        <div className="flex justify-end gap-2">
          <Link to="/don-hang" className={buttonClass('secondary')}>
            Huỷ
          </Link>
          <Button type="submit" loading={create.isPending} disabled={create.isPending}>
            Tạo đơn
          </Button>
        </div>
      </form>
    </>
  );
}
